import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig?.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id' &&
    firebaseConfig?.apiKey
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let googleAuthProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = firebaseConfig.firestoreDatabaseId
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
  googleAuthProvider = new GoogleAuthProvider();
  googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
}

export { app, auth, db, googleAuthProvider };

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser ?? null;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined' && db) {
  void testConnection();
}

export async function signInWithFirebaseGoogle(): Promise<{
  user: User;
  idToken: string;
}> {
  if (!auth || !googleAuthProvider) {
    throw new Error('Firebase authentication is not configured.');
  }
  const credential = await signInWithPopup(auth, googleAuthProvider);
  const idToken = await credential.user.getIdToken();
  return { user: credential.user, idToken };
}

export async function signOutFirebase(): Promise<void> {
  if (!auth) return;
  await signOut(auth).catch(() => undefined);
}

export async function syncFirebaseUserProfile(firebaseUser: User): Promise<void> {
  if (!db || !firebaseUser.email || !firebaseUser.emailVerified) {
    return;
  }
  const profilePath = `users/${firebaseUser.uid}`;
  const docRef = doc(db, 'users', firebaseUser.uid);
  const displayName = (firebaseUser.displayName || firebaseUser.email.split('@')[0] || 'Player')
    .trim()
    .slice(0, 120);

  let snap;
  try {
    snap = await getDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  if (!snap.exists()) {
    try {
      await setDoc(docRef, {
        uid: firebaseUser.uid,
        email: firebaseUser.email.slice(0, 160),
        fullName: displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, profilePath);
    }
  } else {
    try {
      await updateDoc(docRef, {
        fullName: displayName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, profilePath);
    }
  }
}
