(() => {
  'use strict';

  const BASE_W = 941;
  const ROUND_SECONDS = 45;
  const ASSETS = {
    phuljhari: 'assets/phuljhari.gif',
    matchstick: 'assets/matchstick.webp',
    sutli: 'assets/sutli.gif',
    rocket: 'assets/rocket.gif',
    anaar: 'assets/anaar.gif',
    chakri: 'assets/chakri.gif',
    burst: 'assets/burst.gif',
    gameover: 'assets/gameover.gif',
    matchIgnition: 'assets/match-ignition-once.gif'
  };

  // Animated artwork is displayed *as supplied*. Crops below only remove each
  // GIF's transparent padding; they do not change its pixels or timing.
  const KINDS = {
    phuljhari: { points: 10, weight: 40, crop: [220,3,587,234], natural: [724,241], size: .52, speed: 170, radius: 86 },
    anaar:     { points: 25, weight: 25, crop: [234,3,485,236], natural: [724,241], size: .77, speed: 185, radius: 85 },
    sutli:     { points: 0, weight: 19, crop: [285,10,444,234], natural: [724,253], size: .95, speed: 195, radius: 82 },
    chakri:    { points: 60, weight: 12, crop: [119,29,631,213], natural: [724,241], size: .56, speed: 1, radius: 115 },
    rocket:    { points: 100, weight: 4, crop: [205,7,521,236], natural: [724,241], size: .69, speed: 610, radius: 92 }
  };
  const ORDER = ['phuljhari', 'anaar', 'sutli', 'chakri', 'rocket'];
  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const field = $('field');
  const effects = $('effects');
  const igniter = $('igniter');
  const intro = $('intro');
  const gameover = $('gameover');
  const track = $('slide-track');
  const thumb = $('slide-thumb');
  const scoreText = $('score');
  const timerText = $('time');
  const finalScore = $('final-score');
  const endBlast = $('end-blast');
  const ignitionTransition = $('ignition-transition');

  // User-supplied music and effects. The music continues between screens;
  // browser autoplay policy may require the first swipe/tap before it can start.
  const music = $('background-music');
  const musicToggle = $('music-toggle');
  const sounds = {
    match: $('sound-match'),
    correct: [ $('sound-correct') ],
    bomb: $('sound-bomb'),
    result: $('sound-result')
  };
  for (let i = 0; i < 3; i++) {
    const extra = new Audio('assets/firecracker.mp3');
    extra.preload = 'auto';
    sounds.correct.push(extra);
  }
  music.volume = .32;
  sounds.match.volume = .83;
  sounds.bomb.volume = .90;
  sounds.result.volume = .72;
  sounds.correct.forEach(sound => sound.volume = .68);
  let correctVoice = 0;
  let musicEnabled = true;
  let musicVolumeTimer = null;
  try { musicEnabled = localStorage.getItem('your-pataka-music-enabled') !== 'false'; }
  catch (_) { /* Storage can be disabled on local-file previews. */ }

  function updateMusicToggle() {
    musicToggle.setAttribute('aria-pressed', String(musicEnabled));
    musicToggle.setAttribute('aria-label', musicEnabled ? 'Turn background music off' : 'Turn background music on');
    musicToggle.title = musicEnabled ? 'Music on' : 'Music off';
  }
  function tryMusic() {
    if (!musicEnabled || !music.paused) return;
    const started = music.play();
    if (started && typeof started.catch === 'function') {
      // A page cannot force audible autoplay; retry from the first user gesture.
      started.catch(() => {});
    }
  }
  function setMusic(enabled) {
    musicEnabled = enabled;
    updateMusicToggle();
    if (musicEnabled) tryMusic();
    else music.pause(); // preserve playback position when toggling off
    try { localStorage.setItem('your-pataka-music-enabled', String(musicEnabled)); }
    catch (_) {}
  }
  function duckMusic(volume, duration) {
    if (musicVolumeTimer) window.clearTimeout(musicVolumeTimer);
    music.volume = volume;
    musicVolumeTimer = window.setTimeout(() => {
      music.volume = .32;
      musicVolumeTimer = null;
    }, duration);
  }
  function playSound(name) {
    let s;
    if (name === 'correct') {
      s = sounds.correct[correctVoice++ % sounds.correct.length];
    } else s = sounds[name];
    if (!s) return;
    try {
      s.pause();
      s.currentTime = 0;
      const started = s.play();
      if (started && typeof started.catch === 'function') started.catch(() => {});
    } catch (_) {}
  }
  // Clicking the icon must not move the matchstick or ignite a firework.
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    musicToggle.addEventListener(name, event => event.stopPropagation());
  }
  musicToggle.addEventListener('click', () => setMusic(!musicEnabled));
  updateMusicToggle();
  tryMusic();


  const resultFit = $('poster-fit');
  const resultArt = $('result-art');
  const resultImage = $('result-image');
  const resultName = $('result-name');
  const resultTagline = $('result-tagline');

  const RESULT_TIERS = [
    { kind: 'phuljhari', min: 0,   title: 'PHULJHADI',   line: 'Small spark, big energy!' },
    { kind: 'anaar',     min: 220, title: 'ANAAR',       line: 'Quiet at first. Then a spectacle.' },
    { kind: 'chakri',    min: 500, title: 'CHAKRI',      line: 'You keep the world spinning.' },
    { kind: 'rocket',    min: 900, title: 'ROCKET',      line: 'Made to reach the stars.' }
  ];
  // Sutli Bomb is only a hazard. It can never be awarded as a score-based result.

  const settings = {
    round: ROUND_SECONDS,
    pointer: { x: 0, y: 0, visible: false, down: false, kind: 'mouse' },
    score: 0, best: 0, elapsed: 0, remaining: ROUND_SECONDS,
    playing: false, ending: false, transitioning: false, sprites: [],
    spawnIn: .45, lastFrame: 0, nextId: 0, scale: 1,
    width: 941, height: 1672, lastWidth: 0, lastHeight: 0
  };

  try { settings.best = Number(localStorage.getItem('your-pataka-best-v1')) || 0; }
  catch (_) { /* File previews / restricted browsers may not have storage. */ }

  const rand = (low, high) => low + Math.random() * (high - low);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  // Starts approachable; ramps continuously as time runs out.
  // 0s: 1.00x  |  22.5s: ~1.40x  |  45s: 2.20x
  const challenge = () => {
    const t = clamp(settings.elapsed / ROUND_SECONDS, 0, 1);
    return 1 + 1.2 * Math.pow(t, 1.6);
  };

  function resizeStage() {
    const oldW = settings.width;
    const oldH = settings.height;
    settings.width = stage.clientWidth;
    settings.height = stage.clientHeight;
    settings.scale = settings.width / BASE_W;
    if (oldW && oldH && settings.sprites.length) {
      for (const s of settings.sprites) {
        s.x *= settings.width / oldW;
        s.y *= settings.height / oldH;
        s.anchorX *= settings.width / oldW;
        s.anchorY *= settings.height / oldH;
        fitSprite(s);
      }
    }
    if (settings.pointer.visible && oldW && oldH) {
      settings.pointer.x *= settings.width / oldW;
      settings.pointer.y *= settings.height / oldH;
      drawIgniter();
    }
    fitResultPoster();
  }

  function fitResultPoster() {
    // Same object-fit: cover geometry as the poster background. This also
    // keeps the buttons aligned on narrow phones with the cropped artwork.
    const scale = Math.max(settings.width / 1086, settings.height / 1448);
    const dx = (settings.width - 1086 * scale) / 2;
    const dy = (settings.height - 1448 * scale) / 2;
    resultFit.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  function renderResult(reason) {
    // Bomb contact ends gameplay immediately, but never changes the reward tier.
    // The displayed patakha is calculated only from the points earned before death.
    let result = RESULT_TIERS[0];
    for (const level of RESULT_TIERS) {
      if (settings.score >= level.min) result = level;
    }
    finalScore.textContent = settings.score.toLocaleString('en-IN');
    resultName.textContent = result.title;
    resultTagline.textContent = result.line;
    resultImage.src = `assets/result-${result.kind}.png`;
    resultArt.dataset.kind = result.kind;
    resultName.style.fontSize = result.title.length >= 9 ? '67px' : (result.title.length >= 7 ? '76px' : '84px');
    resultTagline.style.fontSize = result.line.length > 31 ? '30px' : '35px';
    // Keep very high scores from overflowing the star decorations.
    const digits = finalScore.textContent.length;
    finalScore.style.fontSize = digits >= 7 ? '85px' : digits >= 6 ? '105px' : '123px';
    gameover.setAttribute('aria-label', `${reason === 'sutli' ? 'Sutli bomb exploded. ' : 'Time is up. '}Your score is ${settings.score}. You are a ${result.title}. ${result.line}`);
    fitResultPoster();
  }

  function spriteElement(kind, crop, natural, factor, className) {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    const img = document.createElement('img');
    img.src = ASSETS[kind];
    img.alt = '';
    img.draggable = false;
    const [left, top, right, bottom] = crop;
    wrapper.style.width = (right - left) * factor + 'px';
    wrapper.style.height = (bottom - top) * factor + 'px';
    img.style.width = natural[0] * factor + 'px';
    img.style.height = natural[1] * factor + 'px';
    img.style.left = -left * factor + 'px';
    img.style.top = -top * factor + 'px';
    wrapper.appendChild(img);
    return wrapper;
  }

  function fitSprite(s) {
    const def = KINDS[s.kind];
    s.factor = def.size * settings.scale;
    s.width = (def.crop[2] - def.crop[0]) * s.factor;
    s.height = (def.crop[3] - def.crop[1]) * s.factor;
    s.hitRadius = def.radius * settings.scale;
    const [l, t] = def.crop;
    s.node.style.width = s.width + 'px';
    s.node.style.height = s.height + 'px';
    const img = s.node.firstElementChild;
    img.style.width = def.natural[0] * s.factor + 'px';
    img.style.height = def.natural[1] * s.factor + 'px';
    img.style.left = -l * s.factor + 'px';
    img.style.top = -t * s.factor + 'px';
    drawSprite(s);
  }

  function drawSprite(s) {
    s.node.style.transform = `translate3d(${s.x - s.width / 2}px, ${s.y - s.height / 2}px, 0) rotate(${s.angle}deg)`;
  }

  function chooseKind() {
    const roll = Math.random() * 100;
    let sum = 0;
    for (const kind of ORDER) {
      sum += KINDS[kind].weight;
      if (roll < sum) return kind;
    }
    return 'phuljhari';
  }

  function spawn(kind = chooseKind()) {
    if (settings.sprites.length >= 8) return;
    const def = KINDS[kind];
    const node = spriteElement(kind, def.crop, def.natural, def.size * settings.scale, 'firework');
    field.appendChild(node);
    const w = settings.width, h = settings.height, f = settings.scale;
    const s = {
      id: ++settings.nextId, kind, node, age: 0, phase: rand(0, Math.PI * 2),
      x: rand(w * .19, w * .81), y: h * .19,
      anchorX: w * .5, anchorY: h * .42,
      angle: 0, vx: rand(-28, 28) * f, vy: def.speed * f * rand(.88, 1.1),
      life: 0, factor: 1, width: 1, height: 1, hitRadius: 1
    };
    // Velocity is scaled every animation frame, not only when the firework spawns.
    if (kind === 'rocket') {
      s.x = rand(w * .18, w * .53);
      s.y = h * .79;
      s.vx = rand(165, 230) * f;
      s.vy = -def.speed * f;
      s.angle = 0;
    } else if (kind === 'chakri') {
      s.anchorX = rand(w * .32, w * .68);
      s.anchorY = rand(h * .37, h * .62);
      s.x = s.anchorX;
      s.y = s.anchorY;
    } else {
      // Spread arrivals near the top of the sky, without covering the HUD.
      s.y = h * rand(.20, .24);
    }
    fitSprite(s);
    settings.sprites.push(s);
  }

  function disposeSprite(s) {
    const i = settings.sprites.indexOf(s);
    if (i >= 0) settings.sprites.splice(i, 1);
    s.node.remove();
  }

  function effectAt(x, y, isBomb = false, isRocket = false) {
    const div = document.createElement('div');
    div.className = 'burst';
    const size = (isRocket ? 310 : isBomb ? 265 : 215) * settings.scale;
    div.style.left = x + 'px';
    div.style.top = y + 'px';
    div.style.width = size + 'px';
    div.style.height = size + 'px';
    const img = document.createElement('img');
    img.src = ASSETS[isBomb ? 'gameover' : 'burst'];
    img.alt = '';
    div.appendChild(img);
    effects.appendChild(div);
    window.setTimeout(() => div.remove(), isBomb ? 1050 : 790);
  }

  function scoreAt(x, y, points) {
    const text = document.createElement('span');
    text.className = 'plus-score';
    text.textContent = '+' + points;
    text.style.left = x + 'px';
    text.style.top = y + 'px';
    effects.appendChild(text);
    window.setTimeout(() => text.remove(), 920);
  }

  function ignite(s) {
    if (!settings.playing || !settings.sprites.includes(s)) return;
    const d = KINDS[s.kind];
    // The sutli bomb is a hazard, not a collectible: instant game-over.
    if (s.kind === 'sutli') {
      finishRound('sutli');
      return;
    }
    settings.score += d.points;
    scoreText.textContent = String(settings.score).padStart(4, '0');
    playSound('correct');
    effectAt(s.x, s.y, false, s.kind === 'rocket');
    scoreAt(s.x, s.y - 35 * settings.scale, d.points);
    disposeSprite(s);
  }

  function hitTest() {
    const p = settings.pointer;
    if (!settings.playing || !p.visible || (p.kind === 'touch' && !p.down)) return;
    for (const s of [...settings.sprites]) {
      const dx = s.x - p.x;
      const dy = s.y - p.y;
      if (dx * dx + dy * dy < s.hitRadius * s.hitRadius) ignite(s);
    }
  }

  function updateSprite(s, dt) {
    const w = settings.width, h = settings.height;
    const pace = challenge();
    s.age += dt * pace;
    if (s.kind === 'chakri') {
      // Orbit/rotation accelerate continuously, while retaining the original path.
      const orbit = s.age * 2.75 + s.phase;
      s.x = clamp(s.anchorX + Math.cos(orbit) * 112 * settings.scale + Math.sin(s.age * 1.2) * 35 * settings.scale, w * .18, w * .82);
      s.y = clamp(s.anchorY + Math.sin(orbit) * 118 * settings.scale + s.age * 17 * settings.scale, h * .21, h * .75);
      s.angle += dt * 290 * pace;
    } else {
      s.x += s.vx * dt * pace + Math.sin(s.age * 1.9 + s.phase) * 7 * settings.scale * dt * pace;
      s.y += s.vy * dt * pace;
      if (s.kind !== 'rocket') {
        s.x = clamp(s.x, w * .13, w * .87);
        s.angle = Math.sin(s.age * 1.75 + s.phase) * 6;
      }
    }
    drawSprite(s);
    if (s.kind === 'chakri' && s.age > 9) disposeSprite(s);
    else if (s.kind === 'rocket' && (s.y < h * .1 || s.x > w * .92)) disposeSprite(s);
    else if (s.kind !== 'chakri' && s.kind !== 'rocket' && s.y > h * .78) disposeSprite(s);
  }

  function finishRound(reason = 'time') {
    if (!settings.playing) return;
    settings.playing = false;
    settings.ending = true;
    stage.classList.remove('playing');
    settings.pointer.visible = false;
    igniter.style.visibility = 'hidden';
    if (reason === 'time') timerText.textContent = '00';
    for (const s of [...settings.sprites]) disposeSprite(s);
    effects.replaceChildren();
    if (settings.score > settings.best) {
      settings.best = settings.score;
      try { localStorage.setItem('your-pataka-best-v1', String(settings.best)); }
      catch (_) {}
    }
    renderResult(reason);
    if (reason === 'sutli') {
      playSound('bomb');
      duckMusic(.10, 3000);
      stage.classList.add('exploding');
      // Start from frame 1 each time; show it only inside the portrait stage.
      const restartedBlast = document.createElement('img');
      restartedBlast.alt = '';
      restartedBlast.src = ASSETS.gameover;
      endBlast.replaceChildren(restartedBlast);
      endBlast.classList.add('visible');
      window.setTimeout(() => {
        endBlast.classList.remove('visible');
        endBlast.replaceChildren();
        stage.classList.remove('exploding');
        if (settings.ending) {
          gameover.classList.add('visible');
          playSound('result');
        }
      }, 1120);
    } else {
      // Running out of time is not a bomb hit.
      gameover.classList.add('visible');
      playSound('result');
    }
  }

  function tick(now) {
    if (!settings.lastFrame) settings.lastFrame = now;
    const dt = Math.min((now - settings.lastFrame) / 1000, .06);
    settings.lastFrame = now;
    if (settings.playing) {
      settings.elapsed += dt;
      settings.remaining = Math.max(0, ROUND_SECONDS - settings.elapsed);
      stage.dataset.pace = challenge().toFixed(2);
      timerText.textContent = String(Math.ceil(settings.remaining)).padStart(2, '0');
      timerText.classList.toggle('low', settings.remaining <= 10);
      settings.spawnIn -= dt;
      if (settings.spawnIn <= 0) {
        spawn();
        // Earlier game: roughly 0.9–1.25s. Final seconds: ~0.45–0.65s.
        settings.spawnIn = rand(.84, 1.25) / (1 + .83 * Math.pow(settings.elapsed / ROUND_SECONDS, 1.25));
      }
      for (const s of [...settings.sprites]) updateSprite(s, dt);
      hitTest();
      if (settings.remaining <= 0) finishRound('time');
    }
    requestAnimationFrame(tick);
  }

  function drawIgniter() {
    if (!settings.pointer.visible || !settings.playing) {
      igniter.style.visibility = 'hidden';
      return;
    }
    // Transparent animated version of the original supplied matchstick, with its flame at the collision point.
    // The player sees the flame make contact, not an invisible cursor hotspot.
    const f = .71 * settings.scale;
    // Contact point is near the match head, rather than the lower wooden shaft.
    const flameX = 74 * f;
    const flameY = 131 * f;
    igniter.style.transform = `translate3d(${settings.pointer.x - flameX}px, ${settings.pointer.y - flameY}px, 0)`;
    igniter.style.visibility = 'visible';
  }

  function fitIgniter() {
    const f = .71 * settings.scale;
    igniter.replaceChildren();
    const img = document.createElement('img');
    img.src = ASSETS.matchstick;
    img.alt = '';
    img.draggable = false;
    img.style.position = 'absolute';
    img.style.left = '0';
    img.style.top = '0';
    img.style.width = 195 * f + 'px';
    img.style.height = 399 * f + 'px';
    img.style.maxWidth = 'none';
    igniter.style.width = 195 * f + 'px';
    igniter.style.height = 399 * f + 'px';
    igniter.appendChild(img);
    drawIgniter();
  }

  function startGame() {
    if (settings.playing) return;
    settings.transitioning = false;
    stage.classList.remove('igniting', 'exploding');
    ignitionTransition.classList.remove('visible');
    const completedIgnition = ignitionTransition.querySelector('img');
    if (completedIgnition) completedIgnition.removeAttribute('src');
    stage.classList.remove('cover-mode');
    resizeStage();
    settings.playing = true;
    settings.ending = false;
    settings.elapsed = 0;
    settings.remaining = ROUND_SECONDS;
    settings.score = 0;
    settings.spawnIn = .3;
    settings.pointer.visible = false;
    settings.pointer.down = false;
    scoreText.textContent = '0000';
    timerText.textContent = '45';
    timerText.classList.remove('low');
    settings.sprites.forEach(s => s.node.remove());
    settings.sprites = [];
    field.replaceChildren();
    effects.replaceChildren();
    stage.classList.add('playing');
    intro.classList.add('hidden');
    gameover.classList.remove('visible');
    endBlast.classList.remove('visible');
    fitIgniter();
  }

  function playIgnitionTransition() {
    if (settings.playing || settings.transitioning) return;
    settings.transitioning = true;
    stage.classList.add('igniting');
    tryMusic();
    playSound('match');
    duckMusic(.17, 2470);
    // The artwork fades to black, then the supplied ignition animation plays
    // at the bottom, before gameplay starts and the timer begins.
    const fresh = document.createElement('img');
    fresh.id = 'ignition-animation';
    fresh.alt = '';
    fresh.width = 418;
    fresh.height = 339;
    ignitionTransition.replaceChildren(fresh);
    ignitionTransition.classList.add('visible');
    // The first visible frame starts after the black transition is onscreen.
    requestAnimationFrame(() => {
      if (settings.transitioning) fresh.src = ASSETS.matchIgnition;
    });
    // The 12-frame GIF (1680 ms) plays ONCE; the black hold lets the
    // full supplied 2.4-second match-lighting sound complete cleanly.
    window.setTimeout(() => {
      if (settings.transitioning) startGame();
    }, 2450);
  }

  function returnToCover() {
    settings.ending = false;
    settings.transitioning = false;
    settings.pointer.visible = false;
    stage.classList.remove('igniting', 'exploding', 'playing');
    stage.classList.add('cover-mode');
    intro.classList.remove('hidden');
    gameover.classList.remove('visible');
    endBlast.classList.remove('visible');
    ignitionTransition.classList.remove('visible');
    ignitionTransition.replaceChildren(document.createElement('img'));
    thumb.classList.add('snap');
    setSlide(0);
    resizeStage();
  }

  function stagePoint(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handlePointer(e) {
    if (!settings.playing) return;
    const p = stagePoint(e);
    const inStage = p.x >= 0 && p.x <= settings.width && p.y >= 0 && p.y <= settings.height;
    settings.pointer.x = p.x;
    settings.pointer.y = p.y;
    settings.pointer.visible = inStage;
    settings.pointer.kind = e.pointerType || 'mouse';
    drawIgniter();
    hitTest();
  }

  stage.addEventListener('pointermove', handlePointer);
  stage.addEventListener('pointerdown', e => {
    if (!settings.playing) return;
    if (e.pointerType === 'touch') {
      settings.pointer.down = true;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    }
    handlePointer(e);
  });
  stage.addEventListener('pointerup', e => {
    settings.pointer.down = false;
    if (e.pointerType === 'touch') {
      settings.pointer.visible = false;
      drawIgniter();
    }
  });
  stage.addEventListener('pointercancel', () => {
    settings.pointer.down = false;
    settings.pointer.visible = false;
    drawIgniter();
  });
  stage.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') {
      settings.pointer.visible = false;
      drawIgniter();
    }
  });

  // Slider is a physical-feeling drag control. Enter/Space also starts the game.
  let sliding = false;
  let slideProgress = 0;
  const setSlide = p => {
    slideProgress = clamp(p, 0, 1);
    const range = track.clientWidth - thumb.clientWidth - 10;
    thumb.style.transform = `translateX(${Math.max(0,range) * slideProgress}px)`;
  };
  function dragSlide(e) {
    const r = track.getBoundingClientRect();
    const travel = r.width - thumb.clientWidth - 10;
    setSlide((e.clientX - r.left - 5 - thumb.clientWidth / 2) / travel);
  }
  track.addEventListener('pointerdown', e => {
    if (settings.playing || settings.transitioning || settings.ending) return;
    sliding = true;
    tryMusic(); // The initial drag is a user gesture, so OST can now play.
    thumb.classList.remove('snap');
    track.setPointerCapture(e.pointerId);
    dragSlide(e);
    e.preventDefault();
  });
  track.addEventListener('pointermove', e => { if (sliding) dragSlide(e); });
  const finishSlide = () => {
    if (!sliding) return;
    sliding = false;
    if (slideProgress >= .82) {
      setSlide(1);
      window.setTimeout(() => { setSlide(0); playIgnitionTransition(); }, 100);
    } else {
      thumb.classList.add('snap');
      setSlide(0);
    }
  };
  track.addEventListener('pointerup', finishSlide);
  track.addEventListener('pointercancel', () => {
    sliding = false;
    thumb.classList.add('snap');
    setSlide(0);
  });
  track.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tryMusic();
      playIgnitionTransition();
    }
  });
  $('home').addEventListener('click', returnToCover);
  $('again').addEventListener('click', () => {
    settings.ending = false;
    gameover.classList.remove('visible');
    endBlast.classList.remove('visible');
    intro.classList.add('hidden');
    playIgnitionTransition();
  });
  window.addEventListener('resize', () => { resizeStage(); fitIgniter(); });
  document.addEventListener('visibilitychange', () => {
    settings.lastFrame = 0;  // A hidden tab does not consume the round timer.
  });
  resizeStage();
  fitIgniter();
  requestAnimationFrame(tick);
})();
