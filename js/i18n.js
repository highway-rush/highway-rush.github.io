// Все тексты игры на трёх языках: русский (ru), казахский (kk), английский (en).

const STRINGS = {
  ru: {
    play: 'Играть', garage: 'Гараж', records: 'Рекорды', settings: 'Настройки',
    menuHint: '←/→ руль · ↑ газ · ↓ тормоз · Пробел прыжок · F полёт · H гудок · Esc пауза',
    chooseMode: 'Выбор режима', chooseLocation: 'Выбор локации',
    musicVolume: 'Музыка', sfxVolume: 'Эффекты', quality: 'Графика',
    qualityLow: 'Низкая', qualityHigh: 'Высокая', tiltControl: 'Руль наклоном',
    off: 'Выкл', on: 'Вкл', language: 'Язык', resetProgress: 'Сбросить прогресс', reset: 'Сброс',
    resetConfirm: 'Удалить монеты, машины и рекорды? Это нельзя отменить.',
    tiltDenied: 'Нет доступа к датчику наклона',
    kmh: 'км/ч', brakeShort: 'Тормоз', gasShort: 'Газ',
    paused: 'Пауза', resume: 'Продолжить', restart: 'Заново', menu: 'Меню',
    newRecord: 'Новый рекорд!', again: 'Ещё раз',
    rotate: 'Поверните телефон горизонтально', continueAnyway: 'Всё равно продолжить',
    mode_endless: 'Бесконечный', mode_endless_d: 'Одностороннее шоссе, 4 полосы. Гони и обгоняй!',
    mode_twoway: 'Встречка', mode_twoway_d: 'По 2 полосы в каждую сторону. Встречная полоса — больше очков.',
    mode_time: 'На время', mode_time_d: '60 секунд. Чекпоинты добавляют время.',
    mode_police: 'Полиция', mode_police_d: 'Догони нарушителя и продержись рядом 2 секунды.',
    loc_highway: 'Шоссе', loc_highway_d: 'Трава, пальмы, солнце',
    loc_snow: 'Снег', loc_snow_d: 'Снегопад и скользкая дорога',
    loc_city: 'Ночной город', loc_city_d: 'Огни, фонари и небоскрёбы',
    loc_rain: 'Дождь', loc_rain_d: 'Мокрый асфальт и туман',
    loc_steppe: 'Степь', loc_steppe_d: 'Степь Казахстана, юрты, закат',
    car_sedan: 'Седан', car_hatch: 'Хэтчбек', car_muscle: 'Маслкар', car_pickup: 'Пикап',
    car_sport: 'Спорткар', car_truck: 'Тягач', car_police: 'Полиция', car_super: 'Суперкар',
    stat_speed: 'Макс. скорость', stat_accel: 'Разгон', stat_handling: 'Управление', stat_braking: 'Торможение',
    buy: 'Купить за {n}', select: 'Выбрать', selected: 'Выбрано', notEnough: 'Не хватает монет',
    colorCost: 'Смена цвета: {n} монет', policeNote: 'В режиме «Полиция» выдаётся автоматически',
    crashed: 'Авария!', timeUp: 'Время вышло!', escaped: 'Нарушитель скрылся!',
    score: 'Очки', distance: 'Дистанция', maxSpeed: 'Макс. скорость', coinsEarned: 'Монеты',
    nearMisses: 'Близкие обгоны', best: 'Рекорд', caughtCount: 'Поймано',
    nearMiss: 'Впритык!', combo: 'Комбо x{n}', oncoming: 'Встречка +{n}',
    checkpoint: 'Чекпоинт! +{n} с', timeLeft: 'Время', caught: 'Пойман! +{n}',
    suspect: 'Нарушитель', chase: 'Погоня', catchIt: 'Держись рядом!',
    th_place: '№', th_score: 'Очки', th_date: 'Дата', th_car: 'Машина', th_loc: 'Локация',
    noRecords: 'Пока нет рекордов. Самое время поставить!', recordShort: 'Рекорд: {n}',
    jump: 'Прыжок', fly: 'Полёт', energy: 'Энергия',
    jumpOver: 'Прыжок через машину! +{n}', jumpOverN: 'Прыжок через {c} машины! +{n}',
    battery: 'Батарейка! +{n}% энергии', lowEnergy: 'Мало энергии!', noEnergy: 'Мало энергии для полёта',
    jumps: 'Прыжки', flyTime: 'Время в полёте', sec: 'с',
    tutJumpKey: 'Нажми ПРОБЕЛ, чтобы прыгнуть', tutJumpTouch: 'Нажми «Прыжок», чтобы прыгнуть',
    tutFlyKey: 'Нажми F, чтобы полететь', tutFlyTouch: 'Нажми «Полёт», чтобы полететь',
    tutFlyMore: 'Энергия копится за обгоны впритык, прыжки и батарейки',
    m: 'м', km: 'км', go: 'Поехали!',
  },
  kk: {
    play: 'Ойнау', garage: 'Гараж', records: 'Рекордтар', settings: 'Баптаулар',
    menuHint: '←/→ рөл · ↑ газ · ↓ тежеу · Пробел секіру · F ұшу · H сигнал · Esc үзіліс',
    chooseMode: 'Режимді таңдаңыз', chooseLocation: 'Локацияны таңдаңыз',
    musicVolume: 'Музыка', sfxVolume: 'Эффектілер', quality: 'Графика',
    qualityLow: 'Төмен', qualityHigh: 'Жоғары', tiltControl: 'Еңкейтіп басқару',
    off: 'Өшірулі', on: 'Қосулы', language: 'Тіл', resetProgress: 'Прогресті өшіру', reset: 'Өшіру',
    resetConfirm: 'Тиындар, көліктер мен рекордтар өшірілсін бе? Мұны қайтару мүмкін емес.',
    tiltDenied: 'Еңкею датчигіне рұқсат жоқ',
    kmh: 'км/сағ', brakeShort: 'Тежеу', gasShort: 'Газ',
    paused: 'Үзіліс', resume: 'Жалғастыру', restart: 'Қайта бастау', menu: 'Мәзір',
    newRecord: 'Жаңа рекорд!', again: 'Тағы да',
    rotate: 'Телефонды көлденең бұрыңыз', continueAnyway: 'Сонда да жалғастыру',
    mode_endless: 'Шексіз', mode_endless_d: 'Бір бағытты тас жол, 4 жолақ. Жылдам жүріп, озып өт!',
    mode_twoway: 'Қарсы жол', mode_twoway_d: 'Әр бағытта 2 жолақтан. Қарсы жолақта ұпай көбірек.',
    mode_time: 'Уақытқа', mode_time_d: '60 секунд. Бақылау нүктелері уақыт қосады.',
    mode_police: 'Полиция', mode_police_d: 'Бұзушыны қуып жетіп, қасында 2 секунд бол.',
    loc_highway: 'Тас жол', loc_highway_d: 'Шөп, пальмалар, күн',
    loc_snow: 'Қар', loc_snow_d: 'Қар жауып тұр, жол тайғақ',
    loc_city: 'Түнгі қала', loc_city_d: 'Шамдар, бағаналар, зәулім үйлер',
    loc_rain: 'Жаңбыр', loc_rain_d: 'Дымқыл асфальт пен тұман',
    loc_steppe: 'Дала', loc_steppe_d: 'Қазақ даласы, киіз үйлер, күн батуы',
    car_sedan: 'Седан', car_hatch: 'Хэтчбек', car_muscle: 'Маслкар', car_pickup: 'Пикап',
    car_sport: 'Спорткар', car_truck: 'Тартқыш', car_police: 'Полиция', car_super: 'Суперкар',
    stat_speed: 'Ең жоғары жылдамдық', stat_accel: 'Үдеу', stat_handling: 'Басқару', stat_braking: 'Тежеу',
    buy: '{n} тиынға сатып алу', select: 'Таңдау', selected: 'Таңдалды', notEnough: 'Тиын жеткіліксіз',
    colorCost: 'Түсін өзгерту: {n} тиын', policeNote: '«Полиция» режимінде автоматты түрде беріледі',
    crashed: 'Апат!', timeUp: 'Уақыт бітті!', escaped: 'Бұзушы қашып кетті!',
    score: 'Ұпай', distance: 'Қашықтық', maxSpeed: 'Ең жоғары жылдамдық', coinsEarned: 'Тиындар',
    nearMisses: 'Жақын озулар', best: 'Рекорд', caughtCount: 'Ұсталды',
    nearMiss: 'Тайып өтті!', combo: 'Комбо x{n}', oncoming: 'Қарсы жолақ +{n}',
    checkpoint: 'Бақылау нүктесі! +{n} с', timeLeft: 'Уақыт', caught: 'Ұсталды! +{n}',
    suspect: 'Бұзушы', chase: 'Қуғын', catchIt: 'Қасында бол!',
    th_place: '№', th_score: 'Ұпай', th_date: 'Күні', th_car: 'Көлік', th_loc: 'Локация',
    noRecords: 'Әзірге рекорд жоқ. Алғашқысын сіз орнатыңыз!', recordShort: 'Рекорд: {n}',
    jump: 'Секіру', fly: 'Ұшу', energy: 'Энергия',
    jumpOver: 'Көліктің үстінен секірдің! +{n}', jumpOverN: '{c} көліктің үстінен секірдің! +{n}',
    battery: 'Батарея! +{n}% энергия', lowEnergy: 'Энергия аз!', noEnergy: 'Ұшуға энергия жетпейді',
    jumps: 'Секірулер', flyTime: 'Ұшу уақыты', sec: 'с',
    tutJumpKey: 'Секіру үшін ПРОБЕЛ пернесін бас', tutJumpTouch: 'Секіру үшін «Секіру» батырмасын бас',
    tutFlyKey: 'Ұшу үшін F пернесін бас', tutFlyTouch: 'Ұшу үшін «Ұшу» батырмасын бас',
    tutFlyMore: 'Энергия жақын озулар, секірулер және батареялар үшін жиналады',
    m: 'м', km: 'км', go: 'Алға!',
  },
  en: {
    play: 'Play', garage: 'Garage', records: 'Records', settings: 'Settings',
    menuHint: '←/→ steer · ↑ gas · ↓ brake · Space jump · F fly · H horn · Esc pause',
    chooseMode: 'Choose mode', chooseLocation: 'Choose location',
    musicVolume: 'Music', sfxVolume: 'Effects', quality: 'Graphics',
    qualityLow: 'Low', qualityHigh: 'High', tiltControl: 'Tilt steering',
    off: 'Off', on: 'On', language: 'Language', resetProgress: 'Reset progress', reset: 'Reset',
    resetConfirm: 'Delete coins, cars and records? This cannot be undone.',
    tiltDenied: 'No access to the tilt sensor',
    kmh: 'km/h', brakeShort: 'Brake', gasShort: 'Gas',
    paused: 'Paused', resume: 'Resume', restart: 'Restart', menu: 'Menu',
    newRecord: 'New record!', again: 'Again',
    rotate: 'Rotate your phone to landscape', continueAnyway: 'Continue anyway',
    mode_endless: 'Endless', mode_endless_d: 'One-way highway, 4 lanes. Drive fast, overtake!',
    mode_twoway: 'Two-way', mode_twoway_d: '2 lanes each way. Oncoming lane gives extra points.',
    mode_time: 'Time attack', mode_time_d: '60 seconds. Checkpoints add time.',
    mode_police: 'Police', mode_police_d: 'Chase the suspect and stay close for 2 seconds.',
    loc_highway: 'Highway', loc_highway_d: 'Grass, palms, sunshine',
    loc_snow: 'Snow', loc_snow_d: 'Snowfall and a slippery road',
    loc_city: 'Night city', loc_city_d: 'Lights, street lamps, towers',
    loc_rain: 'Rain', loc_rain_d: 'Wet asphalt and fog',
    loc_steppe: 'Steppe', loc_steppe_d: 'Kazakh steppe, yurts, sunset',
    car_sedan: 'Sedan', car_hatch: 'Hatchback', car_muscle: 'Muscle car', car_pickup: 'Pickup',
    car_sport: 'Sports car', car_truck: 'Truck', car_police: 'Police', car_super: 'Supercar',
    stat_speed: 'Top speed', stat_accel: 'Acceleration', stat_handling: 'Handling', stat_braking: 'Braking',
    buy: 'Buy for {n}', select: 'Select', selected: 'Selected', notEnough: 'Not enough coins',
    colorCost: 'Change color: {n} coins', policeNote: 'Given automatically in Police mode',
    crashed: 'Crashed!', timeUp: 'Time is up!', escaped: 'The suspect escaped!',
    score: 'Score', distance: 'Distance', maxSpeed: 'Top speed', coinsEarned: 'Coins',
    nearMisses: 'Near misses', best: 'Best', caughtCount: 'Caught',
    nearMiss: 'Near miss!', combo: 'Combo x{n}', oncoming: 'Oncoming +{n}',
    checkpoint: 'Checkpoint! +{n} s', timeLeft: 'Time', caught: 'Busted! +{n}',
    suspect: 'Suspect', chase: 'Chase', catchIt: 'Stay close!',
    th_place: '#', th_score: 'Score', th_date: 'Date', th_car: 'Car', th_loc: 'Location',
    noRecords: 'No records yet. Go set one!', recordShort: 'Best: {n}',
    jump: 'Jump', fly: 'Fly', energy: 'Energy',
    jumpOver: 'Jumped over a car! +{n}', jumpOverN: 'Jumped over {c} cars! +{n}',
    battery: 'Battery! +{n}% energy', lowEnergy: 'Low energy!', noEnergy: 'Not enough energy to fly',
    jumps: 'Jumps', flyTime: 'Flight time', sec: 's',
    tutJumpKey: 'Press SPACE to jump', tutJumpTouch: 'Tap “Jump” to jump',
    tutFlyKey: 'Press F to fly', tutFlyTouch: 'Tap “Fly” to fly',
    tutFlyMore: 'Energy comes from near misses, jumps and batteries',
    m: 'm', km: 'km', go: 'Go!',
  },
};

export const LANGS = [
  { id: 'ru', label: 'RU' },
  { id: 'kk', label: 'ҚАЗ' },
  { id: 'en', label: 'EN' },
];

let current = 'ru';

export function detectLang() {
  const list = navigator.languages || [navigator.language || 'ru'];
  for (const l of list) {
    const code = String(l).toLowerCase().slice(0, 2);
    if (code === 'kk') return 'kk';
    if (code === 'ru') return 'ru';
    if (code === 'en') return 'en';
  }
  return 'en';
}

export function setLang(lang) {
  current = STRINGS[lang] ? lang : 'ru';
  document.documentElement.lang = current;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

export function getLang() { return current; }

export function t(key, params) {
  let s = (STRINGS[current] && STRINGS[current][key]) ?? STRINGS.en[key] ?? key;
  if (params) for (const k in params) s = s.replace('{' + k + '}', params[k]);
  return s;
}
