import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

/**
 * Inicialización del cliente Firebase (Etapa 0.5). La config se arma desde las
 * variables `VITE_FIREBASE_*` del `.env` raíz. En DEV apuntamos al emulador de
 * Auth, por lo que la API key puede ser un valor cualquiera ("demo").
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
} as const;

const app: FirebaseApp = initializeApp(firebaseConfig);

/** Instancia de Auth compartida por toda la app. */
export const auth: Auth = getAuth(app);

/*
 * Si `VITE_FIREBASE_AUTH_EMULATOR` está definida (solo en desarrollo), enrutamos
 * todas las operaciones de Auth al emulador local. `disableWarnings` evita el
 * banner ruidoso del SDK. En producción la var queda vacía y se usa Firebase real.
 */
const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR;
if (emulatorUrl) {
  connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
}
