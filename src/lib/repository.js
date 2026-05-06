import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

function mapSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

async function generateRequestNumber() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const counterRef = doc(db, 'meta', 'counters');
  const key = `req_${dateStr}`;

  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data()[key] ?? 0) : 0;
    const value = current + 1;
    tx.set(counterRef, { [key]: value }, { merge: true });
    return value;
  });

  return `R-${dateStr}-${String(next).padStart(3, '0')}`;
}

function incrementRequestNumber(requestNumber, offset = 0) {
  const parts = String(requestNumber).split('-');
  if (parts.length < 3) return requestNumber;

  const sequence = Number.parseInt(parts[2], 10);
  if (Number.isNaN(sequence)) return requestNumber;

  const nextSequence = String(sequence + offset).padStart(parts[2].length, '0');
  return `${parts[0]}-${parts[1]}-${nextSequence}`;
}

export async function getWorkerByRut(rut) {
  const q = query(
    collection(db, 'workers'),
    where('rut', '==', rut),
    limit(1),
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function withOptionalConstraints(baseConstraints, extraConstraints = []) {
  return [...baseConstraints, ...extraConstraints.filter(Boolean)];
}

function buildCenterCostConstraint(profile) {
  if (profile?.role !== 'supervisor') return null;
  const centerCosts = profile.centerCosts?.filter(Boolean) ?? [];
  if (centerCosts.length === 0) return where('centerCost', '==', '__none__');
  if (centerCosts.length === 1) return where('centerCost', '==', centerCosts[0]);
  return where('centerCost', 'in', centerCosts.slice(0, 10));
}

function buildReimbursementScopeConstraints(profile) {
  if (profile?.role === 'admin' || profile?.role === 'gerencia') {
    return [];
  }
  if (profile?.role === 'supervisor') {
    return withOptionalConstraints([], [buildCenterCostConstraint(profile)]);
  }
  if (profile?.role === 'finance_clerk') {
    return [where('status', 'in', ['approved', 'paid'])];
  }
  if (profile?.role === 'trabajador' || profile?.role === 'worker') {
    return [where('workerId', '==', profile.workerId ?? '__none__')];
  }
  return [];
}

function buildWorkersScopeConstraints(profile) {
  if (profile?.role === 'admin' || profile?.role === 'gerencia') {
    return [];
  }
  if (profile?.role === 'supervisor') {
    return withOptionalConstraints([], [buildCenterCostConstraint(profile)]);
  }
  return [];
}

function buildPaymentBatchScopeConstraints(profile, workerId) {
  if (profile?.role === 'admin' || profile?.role === 'gerencia' || profile?.role === 'finance_clerk') {
    return workerId ? [where('workerId', '==', workerId)] : [];
  }
  return [where('workerId', '==', '__none__')];
}

export async function getDashboardRollup() {
  const snapshot = await getDoc(doc(db, 'dashboardRollups', 'current'));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function subscribeDashboardRollup(onNext, onError) {
  return onSnapshot(
    doc(db, 'dashboardRollups', 'current'),
    (snapshot) => onNext(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError,
  );
}

async function generateGroupId() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const counterRef = doc(db, 'meta', 'counters');
  const key = `grp_${dateStr}`;

  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data()[key] ?? 0) : 0;
    const value = current + 1;
    tx.set(counterRef, { [key]: value }, { merge: true });
    return value;
  });

  return `SOL-${dateStr}-${String(next).padStart(3, '0')}`;
}

function buildDraftReceiptPayload(receipt, workerProfile, { status = 'draft', submittedAt = null } = {}) {
  return {
    requestNumber: receipt.requestNumber ?? '',
    workerId: workerProfile.workerId,
    workerName: workerProfile.displayName,
    workerRut: workerProfile.rut || '',
    centerCost: workerProfile.centerCosts?.[0] || '',
    category: receipt.category || '',
    documentType: receipt.documentType || 'boleta',
    concept: receipt.concept || '',
    amount: Number(receipt.amount) || 0,
    expenseDate: receipt.expenseDate ? new Date(receipt.expenseDate) : null,
    receiptNumber: receipt.receiptNumber || '',
    merchantName: receipt.merchantName || '',
    notes: receipt.notes || '',
    attachmentUrls: receipt.fileUrl ? [receipt.fileUrl] : (receipt.attachmentUrls ?? []),
    status,
    paymentStatus: 'unpaid',
    paymentBatchId: null,
    submittedAt,
    submittedByName: workerProfile.displayName,
    approvedAt: null,
    approvedBy: null,
    approvedByName: null,
    approvalComment: '',
    rejectedAt: null,
    rejectedBy: null,
    rejectedByName: null,
    rejectionReason: '',
    paidAt: null,
    paidBy: null,
    groupId: receipt.groupId ?? null,
  };
}

function buildSubmittedReceiptPayload(receipt, requesterProfile, { groupId, requestNumber, submittedAt }) {
  const workerId = requesterProfile.workerId ?? requesterProfile.uid;
  const workerName = requesterProfile.displayName || requesterProfile.email || 'Usuario';

  return {
    requestNumber,
    workerId,
    workerName,
    workerRut: requesterProfile.rut || '',
    centerCost: requesterProfile.centerCosts?.[0] || '',
    category: receipt.category || '',
    documentType: receipt.documentType || 'boleta',
    concept: receipt.concept || '',
    amount: Number(receipt.amount) || 0,
    expenseDate: receipt.expenseDate ? new Date(receipt.expenseDate) : null,
    receiptNumber: receipt.receiptNumber || '',
    merchantName: receipt.merchantName || '',
    notes: receipt.notes || '',
    attachmentUrls: receipt.fileUrl ? [receipt.fileUrl] : (receipt.attachmentUrls ?? []),
    status: 'pending_approval',
    paymentStatus: 'unpaid',
    paymentBatchId: null,
    submittedAt,
    submittedByName: workerName,
    approvedAt: null,
    approvedBy: null,
    approvedByName: null,
    approvalComment: '',
    rejectedAt: null,
    rejectedBy: null,
    rejectedByName: null,
    rejectionReason: '',
    paidAt: null,
    paidBy: null,
    groupId,
  };
}

export async function submitReimbursementBatch(receipts, workerProfile) {
  const batch = writeBatch(db);
  const groupId = await generateGroupId();
  const baseRequestNumber = await generateRequestNumber();

  for (const [index, receipt] of receipts.entries()) {
    const docRef = doc(collection(db, 'reimbursements'));
    const requestNumber = incrementRequestNumber(baseRequestNumber, index);

    const docData = {
      ...receipt,
      groupId,
      requestNumber,
      workerId: workerProfile.workerId,
      workerName: workerProfile.displayName,
      workerRut: workerProfile.rut || '',
      centerCost: workerProfile.centerCosts?.[0] || '',
      status: 'pending_approval',
      paymentStatus: 'unpaid',
      submittedAt: serverTimestamp(),
      submittedBy: workerProfile.uid,
      submittedByName: workerProfile.displayName,
      createdAt: serverTimestamp(),
    };
    batch.set(docRef, docData);
  }

  await batch.commit();
  return groupId;
}

export async function submitAuthenticatedReimbursementBatch(receipts, requesterProfile) {
  const batch = writeBatch(db);
  const groupId = receipts[0]?.groupId || await generateGroupId();
  const baseRequestNumber = await generateRequestNumber();

  for (const [index, receipt] of receipts.entries()) {
    const docRef = doc(collection(db, 'reimbursements'));
    const requestNumber = incrementRequestNumber(baseRequestNumber, index);

    batch.set(docRef, buildSubmittedReceiptPayload(receipt, requesterProfile, {
      groupId,
      requestNumber,
      submittedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  return groupId;
}

export async function saveReimbursementDraft(receipts, workerProfile) {
  const batch = writeBatch(db);
  const groupId = await generateGroupId();
  
  for (const receipt of receipts) {
    const docRef = doc(collection(db, 'reimbursements'));
    const docData = {
      ...receipt,
      groupId,
      workerId: workerProfile.workerId,
      workerName: workerProfile.displayName,
      status: 'draft',
      paymentStatus: 'unpaid',
      submittedAt: null,
      submittedBy: workerProfile.uid,
      createdAt: serverTimestamp(),
    };
    batch.set(docRef, docData);
  }

  await batch.commit();
  return groupId;
}

export async function createDraftReceipt(workerProfile, groupId = null) {
  const nextGroupId = groupId ?? await generateGroupId();
  const receiptId = crypto.randomUUID();
  const requestNumber = await generateRequestNumber();
  const receiptRef = doc(db, 'reimbursements', receiptId);
  const receipt = {
    id: receiptId,
    groupId: nextGroupId,
    requestNumber,
    category: '',
    concept: '',
    amount: '',
    expenseDate: '',
    receiptNumber: '',
    merchantName: '',
    notes: '',
    fileUrl: '',
    attachmentUrls: [],
  };

  await setDoc(receiptRef, {
    ...buildDraftReceiptPayload(receipt, workerProfile),
    createdAt: serverTimestamp(),
  });

  return receipt;
}

export async function saveDraftReceipt(receipt, workerProfile) {
  const receiptRef = doc(db, 'reimbursements', receipt.id);
  return setDoc(receiptRef, buildDraftReceiptPayload(receipt, workerProfile), { merge: true });
}

export async function submitDraftGroup(receipts, workerProfile) {
  const batch = writeBatch(db);

  for (const receipt of receipts) {
    const receiptRef = doc(db, 'reimbursements', receipt.id);
    const requestNumber = receipt.requestNumber || await generateRequestNumber();
    batch.set(
      receiptRef,
      buildDraftReceiptPayload(
        {
          ...receipt,
          requestNumber,
        },
        workerProfile,
        {
          status: 'pending_approval',
          submittedAt: serverTimestamp(),
        },
      ),
      { merge: true },
    );
  }

  await batch.commit();
  return receipts[0]?.groupId ?? null;
}

export async function deleteDraftReceipt(receiptId) {
  return deleteDoc(doc(db, 'reimbursements', receiptId));
}

export async function createWorker(data) {
  const q = query(collection(db, 'workers'), where('rut', '==', data.rut), limit(1));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    throw new Error(`Ya existe un trabajador con el RUT ${data.rut}`);
  }

  const docData = {
    ...data,
    active: true,
    createdAt: serverTimestamp(),
  };

  return addDoc(collection(db, 'workers'), docData);
}

export async function updateReimbursementStatus(id, { status, profile, comment }) {
  const reimbursementRef = doc(db, 'reimbursements', id);
  const dashboardRef = doc(db, 'dashboardRollups', 'current');

  return runTransaction(db, async (transaction) => {
    const reimbursementSnap = await transaction.get(reimbursementRef);
    if (!reimbursementSnap.exists()) {
      throw new Error('La solicitud ya no existe.');
    }

    const reimbursement = reimbursementSnap.data();
    if (reimbursement.status !== 'pending_approval') {
      throw new Error('La solicitud ya no está pendiente de aprobación.');
    }

    const isAuthorizedReviewer = profile?.role === 'admin'
      || profile?.role === 'gerencia'
      || profile?.role === 'supervisor';
    if (!isAuthorizedReviewer) {
      throw new Error('Unauthorized: insufficient role');
    }
    if (profile?.role === 'supervisor') {
      const allowedCenterCosts = profile.centerCosts?.filter(Boolean) ?? [];
      if (!allowedCenterCosts.includes(reimbursement.centerCost)) {
        throw new Error('Unauthorized: supervisor cannot review this center cost');
      }
    }

    const rollupSnap = await transaction.get(dashboardRef);
    const rollup = rollupSnap.exists() ? rollupSnap.data() : {};
    const amount = Number(reimbursement.amount ?? 0);
    const nextPendingCount = Math.max(0, Number(rollup.pendingCount ?? 0) - 1);
    const nextData = {
      status,
    };

    if (status === 'approved') {
      nextData.paymentStatus = 'unpaid';
      nextData.approvedAt = serverTimestamp();
      nextData.approvedBy = profile.uid;
      nextData.approvedByName = profile.displayName || profile.email;
      nextData.approvalComment = comment || '';

      transaction.set(dashboardRef, {
        pendingCount: nextPendingCount,
        approvedUnpaidCount: Number(rollup.approvedUnpaidCount ?? 0) + 1,
        approvedUnpaidAmount: Number(rollup.approvedUnpaidAmount ?? 0) + amount,
        lastUpdated: serverTimestamp(),
      }, { merge: true });
    } else if (status === 'rejected') {
      nextData.rejectedAt = serverTimestamp();
      nextData.rejectedBy = profile.uid;
      nextData.rejectedByName = profile.displayName || profile.email;
      nextData.rejectionReason = comment || '';

      transaction.set(dashboardRef, {
        pendingCount: nextPendingCount,
        lastUpdated: serverTimestamp(),
      }, { merge: true });
    } else {
      throw new Error('Estado de revisión no soportado.');
    }

    transaction.set(reimbursementRef, nextData, { merge: true });
  });
}

export async function createPaymentBatch(batchData, requestIds, profile) {
  const isAuthorizedPayer = profile?.role === 'admin'
    || profile?.role === 'gerencia'
    || profile?.role === 'finance_clerk';
  if (!isAuthorizedPayer) {
    throw new Error('Unauthorized: insufficient role');
  }

  const batch = writeBatch(db);
  const batchRef = doc(collection(db, 'paymentBatches'));
  const batchId = batchRef.id;

  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  const batchNumber = `B-${dateStr}-${batchId.substring(0, 4).toUpperCase()}`;

  const fullBatchData = {
    ...batchData,
    batchNumber,
    paidAt: serverTimestamp(),
    paidBy: profile.uid,
    paidByName: profile.displayName || profile.email,
    requestIds,
    createdAt: serverTimestamp(),
  };

  batch.set(batchRef, fullBatchData);

  requestIds.forEach((id) => {
    const ref = doc(db, 'reimbursements', id);
    batch.update(ref, {
      status: 'paid',
      paymentStatus: 'paid',
      paymentBatchId: batchId,
      paidAt: serverTimestamp(),
      paidBy: profile.uid,
      paidByName: profile.displayName || profile.email,
    });
  });

  await batch.commit();
  return { id: batchId, batchNumber };
}

export async function createWorkersBatch(workersData) {
  const batch = writeBatch(db);

  for (const data of workersData) {
    const docRef = doc(collection(db, 'workers'));
    batch.set(docRef, {
      ...data,
      active: true,
      createdAt: serverTimestamp(),
    });
  }

  return batch.commit();
}

export async function updateWorker(id, data) {
  const docRef = doc(db, 'workers', id);
  return setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export function subscribeWorker(workerId, onNext, onError) {
  return onSnapshot(
    doc(db, 'workers', workerId),
    (snapshot) => onNext(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError,
  );
}

export async function getWorkers({ profile, onlyActive = false } = {}) {
  const workersQuery = query(
    collection(db, 'workers'),
    ...withOptionalConstraints(
      [orderBy('fullName', 'asc')],
      [
        ...buildWorkersScopeConstraints(profile),
        onlyActive ? where('active', '==', true) : null,
      ],
    ),
  );
  return mapSnapshot(await getDocs(workersQuery));
}

export function subscribeWorkers({ profile, onlyActive = false } = {}, onNext, onError) {
  const workersQuery = query(
    collection(db, 'workers'),
    ...withOptionalConstraints(
      [orderBy('fullName', 'asc')],
      [
        ...buildWorkersScopeConstraints(profile),
        onlyActive ? where('active', '==', true) : null,
      ],
    ),
  );
  return onSnapshot(workersQuery, (snapshot) => onNext(mapSnapshot(snapshot)), onError);
}

export async function getReimbursements({ profile, status, paymentStatus, workerId, limitTo = 100 } = {}) {
  const reimbursementsQuery = query(
    collection(db, 'reimbursements'),
    ...withOptionalConstraints(
      [orderBy('submittedAt', 'desc')],
      [
        ...buildReimbursementScopeConstraints(profile),
        status ? where('status', '==', status) : null,
        paymentStatus ? where('paymentStatus', '==', paymentStatus) : null,
        workerId ? where('workerId', '==', workerId) : null,
        limitTo ? limit(limitTo) : null,
      ],
    ),
  );
  return mapSnapshot(await getDocs(reimbursementsQuery));
}

export function subscribeReimbursements(
  { profile, status, paymentStatus, workerId, limitTo = 100 } = {},
  onNext,
  onError,
) {
  const reimbursementsQuery = query(
    collection(db, 'reimbursements'),
    ...withOptionalConstraints(
      [orderBy('submittedAt', 'desc')],
      [
        ...buildReimbursementScopeConstraints(profile),
        status ? where('status', '==', status) : null,
        paymentStatus ? where('paymentStatus', '==', paymentStatus) : null,
        workerId ? where('workerId', '==', workerId) : null,
        limitTo ? limit(limitTo) : null,
      ],
    ),
  );
  return onSnapshot(reimbursementsQuery, (snapshot) => onNext(mapSnapshot(snapshot)), onError);
}

export function subscribeWorkerReimbursements(workerId, onNext, onError) {
  const reimbursementsQuery = query(
    collection(db, 'reimbursements'),
    where('workerId', '==', workerId || '__none__'),
    orderBy('submittedAt', 'desc'),
  );
  return onSnapshot(reimbursementsQuery, (snapshot) => onNext(mapSnapshot(snapshot)), onError);
}

export async function getPaymentBatches({ profile, workerId, limitTo = 20 } = {}) {
  const paymentBatchesQuery = query(
    collection(db, 'paymentBatches'),
    ...withOptionalConstraints(
      [orderBy('paidAt', 'desc')],
      [
        ...buildPaymentBatchScopeConstraints(profile, workerId),
        limitTo ? limit(limitTo) : null,
      ],
    ),
  );
  return mapSnapshot(await getDocs(paymentBatchesQuery));
}

export function subscribePaymentBatches({ profile, workerId, limitTo = 20 } = {}, onNext, onError) {
  const paymentBatchesQuery = query(
    collection(db, 'paymentBatches'),
    ...withOptionalConstraints(
      [orderBy('paidAt', 'desc')],
      [
        ...buildPaymentBatchScopeConstraints(profile, workerId),
        limitTo ? limit(limitTo) : null,
      ],
    ),
  );
  return onSnapshot(paymentBatchesQuery, (snapshot) => onNext(mapSnapshot(snapshot)), onError);
}

export async function getUsers({ onlyRole } = {}) {
  const usersQuery = query(
    collection(db, 'users'),
    ...withOptionalConstraints(
      [orderBy('displayName', 'asc')],
      [onlyRole ? where('role', '==', onlyRole) : null],
    ),
  );
  return mapSnapshot(await getDocs(usersQuery));
}

export function subscribeUsers({ onlyRole } = {}, onNext, onError) {
  const usersQuery = query(
    collection(db, 'users'),
    ...withOptionalConstraints(
      [orderBy('displayName', 'asc')],
      [onlyRole ? where('role', '==', onlyRole) : null],
    ),
  );
  return onSnapshot(usersQuery, (snapshot) => onNext(mapSnapshot(snapshot)), onError);
}

export async function createCostCenter(name) {
  return addDoc(collection(db, 'costCenters'), { name: name.trim(), createdAt: new Date() });
}

export async function deleteCostCenter(id) {
  return deleteDoc(doc(db, 'costCenters', id));
}

export function subscribeCostCenters(onNext, onError) {
  const costCentersQuery = query(
    collection(db, 'costCenters'),
    orderBy('name', 'asc'),
  );
  return onSnapshot(costCentersQuery, (snapshot) => onNext(mapSnapshot(snapshot)), onError);
}

export async function updateUser(id, data) {
  return setDoc(doc(db, 'users', id), data, { merge: true });
}

export async function deleteUser(id) {
  return deleteDoc(doc(db, 'users', id));
}

export async function markReimbursementsAsPrinted(ids, profile) {
  const batch = writeBatch(db);
  ids.forEach((id) => {
    const ref = doc(db, 'reimbursements', id);
    batch.update(ref, {
      printedAt: serverTimestamp(),
      printedBy: profile.uid,
      printedByName: profile.displayName || profile.email,
    });
  });
  return batch.commit();
}
