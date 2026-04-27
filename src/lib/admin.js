import { firebaseConfig } from './firebase';
import { updateUser } from './repository';

function randomPassword() {
  return `Tmp!${Math.random().toString(36).slice(2, 8)}A1`;
}

function normalizeCompanyEmail(email) {
  return email
    .trim()
    .toLowerCase()
    .replace(/@gmt\.cl$/i, '@gmtingenieria.com')
    .replace(/@gmt\.com$/i, '@gmtingenieria.com');
}

async function postIdentityToolkit(path, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'AUTH_REQUEST_FAILED');
  }

  return payload;
}

export async function createInternalUser({
  email,
  displayName,
  role,
  rut,
  centerCosts,
  bankName = '',
  bankAccountType = '',
  bankAccountNumber = '',
  workerId = null,
  createdBy = 'system',
}) {
  const normalizedEmail = normalizeCompanyEmail(email);
  const temporaryPassword = randomPassword();
  const signUpPayload = await postIdentityToolkit('accounts:signUp', {
    email: normalizedEmail,
    password: temporaryPassword,
    returnSecureToken: false,
  });

  await updateUser(signUpPayload.localId, {
    uid: signUpPayload.localId,
    email: normalizedEmail,
    displayName: displayName.trim(),
    role,
    rut: rut.trim(),
    centerCosts,
    bankName: bankName.trim(),
    bankAccountType: bankAccountType.trim(),
    bankAccountNumber: bankAccountNumber.trim(),
    workerId,
    active: true,
    mustChangePassword: true,
    profileVerified: false,
    createdAt: new Date(),
    createdBy,
    lastLoginAt: null,
  });

  await postIdentityToolkit('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email: normalizedEmail,
  });

  return {
    uid: signUpPayload.localId,
    temporaryPassword,
  };
}

export async function sendPasswordSetupEmail(email) {
  await postIdentityToolkit('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email: normalizeCompanyEmail(email),
  });
}
