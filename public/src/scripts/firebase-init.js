// =========================
// FIREBASE — CONFIGURAÇÃO ÚNICA
// Compartilhado por loja, checkout e pagamento.
// =========================
const firebaseConfig = {
  apiKey: "AIzaSyCxXhUobxrTjxVoHLDc2bR3WI6ujdSLZjc",
  authDomain: "cor-indivisum.firebaseapp.com",
  projectId: "cor-indivisum",
  storageBucket: "cor-indivisum.firebasestorage.app",
  messagingSenderId: "803854386234",
  appId: "1:803854386234:web:ad86ffc2d9a9dd11072103"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// functions só é necessário em checkout e pagamento (usa Cloud Functions).
// Definido aqui para evitar repetir a linha nos dois arquivos.
const functions = firebase.app().functions("southamerica-east1");