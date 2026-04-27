// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBj9V4iLs40rdftaY4w-CQK3vGaAOagNMA",
  authDomain: "gmt-hub-6d8f7.firebaseapp.com",
  projectId: "gmt-hub-6d8f7",
  storageBucket: "gmt-hub-6d8f7.firebasestorage.app",
  messagingSenderId: "646379458477",
  appId: "1:646379458477:web:c2c78c6088eed6a82c1b24",
  measurementId: "G-K6DYTQ9LVB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);