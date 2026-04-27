import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getAI, GoogleAIBackend } from 'firebase/ai';

export const firebaseConfig = {
  apiKey: 'AIzaSyBj9V4iLs40rdftaY4w-CQK3vGaAOagNMA',
  authDomain: 'gmt-hub-6d8f7.firebaseapp.com',
  projectId: 'gmt-hub-6d8f7',
  storageBucket: 'gmt-hub-6d8f7.firebasestorage.app',
  messagingSenderId: '646379458477',
  appId: '1:646379458477:web:f58de0c2d256d9282c1b24',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const firebaseAI = getAI(app, { backend: new GoogleAIBackend() });
