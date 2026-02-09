import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, push, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCGJ34XNV1G995WNhMgCDjOmjiT0CeS-7Y",
  authDomain: "cricliv-43fb4.firebaseapp.com",
  databaseURL: "https://cricliv-43fb4-default-rtdb.firebaseio.com",
  projectId: "cricliv-43fb4",
  storageBucket: "cricliv-43fb4.firebasestorage.app",
  messagingSenderId: "433229998063",
  appId: "1:433229998063:web:ca957676350fc5711f781a"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, get, update, onValue, push, remove, serverTimestamp };
