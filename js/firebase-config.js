// Настройки Firebase для онлайн-режима.
// Скопируйте сюда объект firebaseConfig из консоли Firebase:
//   console.firebase.google.com → ваш проект → ⚙ Настройки проекта → «Ваши приложения» → Веб-приложение.
// Эти значения НЕ секретные: они всё равно видны в браузере. Защиту обеспечивают правила базы
// (файл database.rules.json) и вход только через Anonymous Auth.
// Пока apiKey пустой, кнопка «Онлайн» покажет сообщение «Онлайн ещё не настроен», а одиночная игра работает как обычно.

export const firebaseConfig = {
  apiKey: 'AIzaSyB-ZwIveKbZuW_J6dE6L8UubWfXl49pe9U',
  authDomain: 'highway-rush-33ee4.firebaseapp.com',
  databaseURL: 'https://highway-rush-33ee4-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'highway-rush-33ee4',
  storageBucket: 'highway-rush-33ee4.firebasestorage.app',
  messagingSenderId: '288810452121',
  appId: '1:288810452121:web:32501ca4deeb4626dee408',
};
