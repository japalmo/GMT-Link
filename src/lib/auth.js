import {
  browserLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

let persistenceReady;

function ensurePersistence() {
  if (!persistenceReady) {
    persistenceReady = setPersistence(auth, browserLocalPersistence);
  }
  return persistenceReady;
}

export function observeAuthState(listener) {
  return onAuthStateChanged(auth, listener);
}

export async function loginWithEmailPassword(email, password) {
  await ensurePersistence();
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export function logoutUser() {
  return signOut(auth);
}

export function sendPasswordResetLink(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function loadUserProfile(uid) {
  const profileSnap = await getDoc(doc(db, 'users', uid));
  if (!profileSnap.exists()) return null;

  const data = profileSnap.data();
  return {
    id: profileSnap.id,
    rut: '',
    bankName: '',
    bankAccountType: '',
    bankAccountNumber: '',
    ...data,
  };
}
