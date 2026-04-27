import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gmt-hub-6d8f7';
const COST_CENTER_ALBEMARLE = 'Albemarle La Negra';
const TARGET_COLLECTIONS = [
  'users',
  'workers',
  'reimbursements',
  'paymentBatches',
  'dashboardRollups',
  'seedMeta',
];
const BACKUP_COLLECTIONS = [
  'costCenters',
  ...TARGET_COLLECTIONS,
];

const UAT_USERS = [
  {
    email: 'jsanta@gmtingenieria.com',
    password: 'John2026.',
    displayName: 'John Santa',
    role: 'admin',
    rut: '',
    centerCosts: [],
    workerId: null,
  },
  {
    email: 'mpoblete@gmtingenieria.com',
    password: 'Marisol2026.',
    displayName: 'Marisol Poblete',
    role: 'finance_clerk',
    rut: '',
    centerCosts: [],
    workerId: null,
  },
  {
    email: 'gestion@gmtingenieria.com',
    password: 'Admin123!',
    displayName: 'Juan Apalmo',
    role: 'admin',
    rut: '',
    centerCosts: [],
    workerId: null,
  },
  {
    email: 'hleiva@gmtingenieria.com',
    password: 'Humberto2026.',
    displayName: 'Humberto Leiva',
    role: 'supervisor',
    rut: '',
    centerCosts: [COST_CENTER_ALBEMARLE],
    workerId: null,
  },
  {
    email: 'bgil@gmtingenieria.com',
    password: 'Bryan2026.',
    displayName: 'Bryan Gil',
    role: 'worker',
    rut: '21.456.781-3',
    centerCosts: [COST_CENTER_ALBEMARLE],
    workerId: 'worker-bgil',
  },
  {
    email: 'mtapia@gmtingenieria.com',
    password: 'Mario2026.',
    displayName: 'Mario Tapia',
    role: 'gerencia',
    rut: '',
    centerCosts: [],
    workerId: null,
  },
];

const BRYAN_WORKER = {
  id: 'worker-bgil',
  fullName: 'Bryan Gil',
  rut: '21.456.781-3',
  email: 'bgil@gmtingenieria.com',
  personalEmail: 'bgil@gmtingenieria.com',
  phone: '',
  address: '',
  employeeCode: 'WKR-BGIL',
  department: '',
  centerCost: COST_CENTER_ALBEMARLE,
  location: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
};

function printHelp() {
  console.log(`GMT Link UAT reset script

Usage:
  npm run reset:uat -- --service-account=/abs/path/service-account.json
  npm run reset:uat -- --service-account=/abs/path/service-account.json --execute

Behavior:
  - Dry-run by default.
  - Backs up Auth users + Firestore collections before any destructive action.
  - Keeps costCenters intact.
  - Recreates exactly the 6 UAT users approved by PM.

Options:
  --service-account=PATH  Required. Firebase service account JSON path.
  --backup-dir=PATH       Optional. Output dir for JSON backups.
  --execute               Actually performs delete + recreate.
  --help                  Show this message.
`);
}

function parseArgs(argv) {
  const options = {
    execute: false,
    serviceAccountPath: '',
    backupDir: '',
    help: false,
  };

  argv.forEach((arg) => {
    if (arg === '--execute') {
      options.execute = true;
      return;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return;
    }
    if (arg.startsWith('--service-account=')) {
      options.serviceAccountPath = arg.slice('--service-account='.length);
      return;
    }
    if (arg.startsWith('--backup-dir=')) {
      options.backupDir = arg.slice('--backup-dir='.length);
    }
  });

  return options;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeValue(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeValue(nestedValue)]),
    );
  }
  return value;
}

async function loadServiceAccount(serviceAccountPath) {
  if (!serviceAccountPath) {
    throw new Error('Missing --service-account=PATH. A service account is required for Admin SDK access.');
  }

  const raw = await readFile(serviceAccountPath, 'utf8');
  return JSON.parse(raw);
}

async function ensureDir(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

async function writeJson(targetPath, payload) {
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function listAllAuthUsers(auth) {
  const users = [];
  let nextPageToken;

  do {
    const page = await auth.listUsers(1000, nextPageToken);
    users.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return users;
}

async function backupAuth(auth, backupDir) {
  const users = await listAllAuthUsers(auth);
  const payload = users.map((user) => ({
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    disabled: user.disabled,
    emailVerified: user.emailVerified,
    metadata: user.metadata,
  }));

  await writeJson(path.join(backupDir, 'auth-users.json'), payload);
  return users;
}

async function backupCollection(db, backupDir, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const payload = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: normalizeValue(doc.data()),
  }));

  await writeJson(path.join(backupDir, `${collectionName}.json`), payload);
  return snapshot.docs;
}

async function backupFirestore(db, backupDir) {
  const counts = {};
  for (const collectionName of BACKUP_COLLECTIONS) {
    const docs = await backupCollection(db, backupDir, collectionName);
    counts[collectionName] = docs.length;
  }
  return counts;
}

async function deleteCollectionDocs(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) {
    return 0;
  }

  let deleted = 0;
  const chunks = [];
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    chunks.push(snapshot.docs.slice(index, index + 400));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

async function deleteAuthUsers(auth, users) {
  if (users.length === 0) {
    return { successCount: 0, failureCount: 0, errors: [] };
  }

  const uidChunks = [];
  for (let index = 0; index < users.length; index += 1000) {
    uidChunks.push(users.slice(index, index + 1000).map((item) => item.uid));
  }

  const aggregate = {
    successCount: 0,
    failureCount: 0,
    errors: [],
  };

  for (const chunk of uidChunks) {
    const result = await auth.deleteUsers(chunk);
    aggregate.successCount += result.successCount;
    aggregate.failureCount += result.failureCount;
    aggregate.errors.push(...result.errors.map((item) => ({
      index: item.index,
      message: item.error?.message ?? 'UNKNOWN_DELETE_ERROR',
    })));
  }

  return aggregate;
}

async function createAuthUsers(auth) {
  const createdUsers = new Map();

  for (const user of UAT_USERS) {
    const record = await auth.createUser({
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      emailVerified: false,
      disabled: false,
    });
    createdUsers.set(user.email, record);
  }

  return createdUsers;
}

async function writeUserDocs(db, createdUsers) {
  const batch = db.batch();
  const createdAt = Timestamp.now();

  for (const user of UAT_USERS) {
    const authRecord = createdUsers.get(user.email);
    batch.set(db.collection('users').doc(authRecord.uid), {
      uid: authRecord.uid,
      email: user.email,
      displayName: user.displayName,
      rut: user.rut,
      role: user.role,
      centerCosts: user.centerCosts,
      active: true,
      bankName: '',
      bankAccountType: '',
      bankAccountNumber: '',
      workerId: user.workerId,
      createdAt,
      createdBy: 'uat_reset_script',
      lastLoginAt: null,
    });
  }

  await batch.commit();
}

async function writeWorkerDocs(db, createdUsers) {
  const batch = db.batch();
  const createdAt = Timestamp.now();
  const supervisor = createdUsers.get('hleiva@gmtingenieria.com');

  batch.set(db.collection('workers').doc(BRYAN_WORKER.id), {
    ...BRYAN_WORKER,
    joinedAt: createdAt,
    active: true,
    supervisorId: supervisor.uid,
    supervisorName: 'Humberto Leiva',
    createdAt,
    createdBy: 'uat_reset_script',
  });

  await batch.commit();
}

async function writeDashboardBase(db) {
  const now = Timestamp.now();
  await db.collection('dashboardRollups').doc('current').set({
    pendingCount: 0,
    approvedUnpaidCount: 0,
    approvedUnpaidAmount: 0,
    paidThisMonthAmount: 0,
    paidThisMonthCount: 0,
    totalWorkersActive: 1,
    lastUpdated: now,
    requestsThisMonth: 0,
    pendingApprovalCount: 0,
    amountToPay: 0,
    paidThisMonth: 0,
    source: 'uat_reset',
  });
}

async function writeResetMeta(db) {
  await db.collection('seedMeta').doc('uatReset').set({
    source: 'uat_reset',
    projectId: PROJECT_ID,
    resetAt: Timestamp.now(),
    collections: {
      users: 6,
      workers: 1,
      reimbursements: 0,
      paymentBatches: 0,
      dashboardRollups: 1,
    },
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const serviceAccount = await loadServiceAccount(options.serviceAccountPath);
  const backupDir = path.resolve(
    options.backupDir || path.join(process.cwd(), '.local-backups', `gmt-link-uat-reset-${nowStamp()}`),
  );
  const dryRun = !options.execute;

  initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID,
  });

  const auth = getAuth();
  const db = getFirestore();

  await ensureDir(backupDir);

  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`Backup dir: ${backupDir}`);

  const authUsers = await backupAuth(auth, backupDir);
  const firestoreCounts = await backupFirestore(db, backupDir);

  console.log(`Auth users backed up: ${authUsers.length}`);
  Object.entries(firestoreCounts).forEach(([collectionName, count]) => {
    console.log(`Firestore backup ${collectionName}: ${count}`);
  });

  if (dryRun) {
    console.log('Dry run finished. No Auth users or Firestore documents were modified.');
    return;
  }

  const deletedCollections = {};
  for (const collectionName of TARGET_COLLECTIONS) {
    deletedCollections[collectionName] = await deleteCollectionDocs(db, collectionName);
  }

  const deletedAuth = await deleteAuthUsers(auth, authUsers);
  if (deletedAuth.failureCount > 0) {
    throw new Error(`Auth delete had ${deletedAuth.failureCount} failures. Aborting before recreate.`);
  }

  const createdUsers = await createAuthUsers(auth);
  await writeUserDocs(db, createdUsers);
  await writeWorkerDocs(db, createdUsers);
  await writeDashboardBase(db);
  await writeResetMeta(db);

  console.log('Deleted collections:');
  Object.entries(deletedCollections).forEach(([collectionName, count]) => {
    console.log(`- ${collectionName}: ${count}`);
  });
  console.log(`Deleted Auth users: ${deletedAuth.successCount}`);
  console.log(`Created Auth users: ${createdUsers.size}`);
  console.log('Recreated users/workers/dashboardRollups/current/seedMeta/uatReset.');
}

run().catch((error) => {
  console.error('UAT reset script failed.');
  console.error(error);
  process.exitCode = 1;
});
