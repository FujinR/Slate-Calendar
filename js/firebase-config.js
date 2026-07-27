// Paste your Firebase project's web app config here (Firebase console > Project settings >
// General > Your apps > Web app > SDK setup and configuration > Config). See README.md.
export const firebaseConfig = {
  apiKey: "AIzaSyDxPwqmicjY-1fu3-UPxtMbwDW1Mcd1V38",
  authDomain: "slate-4af55.firebaseapp.com",
  projectId: "slate-4af55",
  storageBucket: "slate-4af55.firebasestorage.app",
  messagingSenderId: "415473159452",
  appId: "1:415473159452:web:841bc904eb959a8383bed9"
};

// Until you fill in a real config above, the site runs in demo mode: the guest page and
// dashboard show sample data instead of talking to Firebase, so you can preview the design
// before setting anything up.
export const DEMO_MODE = firebaseConfig.apiKey === "Your_API_KEY";

const SDK_VERSION = "10.13.0";

export let app = null;
export let auth = null;
export let db = null;
let authMod = null;
let dbMod = null;
let initPromise = null;

export async function getFirebase() {
  if (DEMO_MODE) return { app: null, auth: null, db: null, authMod: null, dbMod: null };
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const [{ initializeApp }, authModule, dbModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
    ]);
    authMod = authModule;
    dbMod = dbModule;
    app = initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = dbMod.getFirestore(app);
    return { app, auth, db, authMod, dbMod };
  })();
  return initPromise;
}
