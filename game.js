"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");

  const ui = {
    score: $("score"), best: $("best-score"), level: $("level"), wave: $("wave"),
    healthText: $("health-text"), healthBar: $("health-bar"), kills: $("kills"),
    clock: $("clock"), threat: $("threat"), status: $("status"),
    overlay: $("overlay"), overlayTag: $("overlay-tag"), overlayTitle: $("overlay-title"),
    overlayText: $("overlay-text"), overlayBtn: $("overlay-btn"),
    startBtn: $("start-btn"), pauseBtn: $("pause-btn"),
    weaponName: $("weapon-name"), weaponDescription: $("weapon-description"),
    toast: $("toast"), soundBtn: $("sound-btn")
  };

  const W = 960, H = 600, WAVES_PER_LEVEL = 3, MAX_LEVEL = 3;
  canvas.width = W;
  canvas.height = H;

  const keys = new Set();
  const pointer = { x: W / 2 + 100, y: H / 2, down: false };
  const weapons = [
    { name: "PULSE PISTOL", description: "Balanced · Standard fire", delay: 0.19, damage: 1, speed: 620, spread: 0, count: 1 },
    { name: "RAPID BLASTER", description: "Fast fire · Lighter shots", delay: 0.095, damage: 1, speed: 660, spread: 0.07, count: 1 },
    { name: "TRI-BURST CANNON", description: "Three-shot spread · Heavy damage", delay: 0.32, damage: 1, speed: 570, spread: 0.22, count: 3 }
  ];

  let player, bullets, enemies, particles, pickups, boss;
  let score = 0, kills = 0, level = 1, wave = 1, elapsed = 0;
  let spawnClock = 0, shotClock = 0, damageClock = 0, pickupClock = 0;
  let running = false, paused = false, gameOver = false, campaignComplete = false;
  let lastTime = 0, animationId = 0, toastTimer = 0;
  let weaponIndex = 0, soundOn = true, audioContext = null;
  let best = readNumber("cyberstrike-best", 0);
  let unlockedLevel = Math.max(1, Math.min(MAX_LEVEL, readNumber("cyberstrike-unlocked", 1)));

  function readNumber(key, fallback) {
    try {
      const n = Number(localStorage.getItem(key));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    } catch { return fallback; }
  }
  function saveNumber(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* storage optional */ }
  }
  function fmt(n) { return String(Math.floor(n)).padStart(6, "0"); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function rand(min, max) { return min + Math.random() * (max - min); }

  function initState() {
    player = { x: W / 2, y: H / 2, radius: 13, speed: 250, health: 100, angle: 0, invulnerable: 0, shield: 0 };
    bullets = []; enemies = []; particles = []; pickups = []; boss = null;
    score = 0; kills = 0; level = 1; wave = 1; elapsed = 0;
    spawnClock = 0; shotClock = 0; damageClock = 0; pickupClock = 9;
    window._waveSpawned = 0;
    weaponIndex = 0; paused = false; gameOver = false; campaignComplete = false;
    updateHUD();
    updateWeaponUI();
  }

  function updateHUD() {
    ui.score.textContent = fmt(score);
    ui.best.textContent = fmt(best);
    ui.level.textContent = String(level).padStart(2, "0");
    ui.wave.textContent = `${String(wave).padStart(2, "0")} / 03`;
    ui.healthText.textContent = `${Math.ceil(player ? player.health : 100)}%`;
    ui.healthBar.style.width = `${clamp(player ? player.health : 100, 0, 100)}%`;
    ui.healthBar.style.background = (player && player.health < 30) ? "#ff4da6" : "#35f2e5";
    ui.kills.textContent = kills;
    ui.threat.textContent = boss ? "BOSS" : (level >= 3 || wave >= 3 ? "HIGH" : wave >= 2 ? "MEDIUM" : "LOW");
    const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
    ui.clock.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateWeaponUI() {
    const w = weapons[weaponIndex];
    ui.weaponName.textContent = w.name;
    ui.weaponDescription.textContent = w.description;
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    toastTimer = 1.8;
  }

  function beep(frequency = 440, duration = 0.055, type = "sine", volume = 0.025) {
    if (!soundOn) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + duration);
    } catch { /* sound is optional */ }
  }

  function resetCampaign() {
    initState();
    ui.status.textContent = "STANDBY";
    ui.startBtn.textContent = "START CAMPAIGN";
    ui.pauseBtn.disabled = true;
    ui.pauseBtn.textContent = "PAUSE GAME";
    ui.overlayTag.textContent = "CAMPAIGN // MISSION 001";
    ui.overlayTitle.innerHTML = 'READY TO<br><span class="accent">DEPLOY?</span>';
    ui.overlayText.textContent = "Survive three waves per level. Defeat the Core to complete the campaign.";
    ui.overlayBtn.textContent = "ENTER THE ARENA →";
    ui.overlay.classList.remove("hidden");
    draw();
  }

  function startMission() {
    if (running && !paused) return;
    if (paused) { resumeGame(); return; }
    if (gameOver || campaignComplete || !player) resetCampaign();
    running = true; paused = false; gameOver = false;
    ui.overlay.classList.add("hidden");
    ui.status.textContent = "ACTIVE";
    ui.startBtn.textContent = "RESTART CAMPAIGN";
    ui.pauseBtn.disabled = false;
    ui.pauseBtn.textContent = "PAUSE GAME";
    lastTime = performance.now();
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(loop);
    beep(520, 0.08);
  }

  function pauseGame() {
    if (!running || gameOver || campaignComplete) return;
    paused = true; running = false; pointer.down = false;
    ui.overlay.classList.remove("hidden");
    ui.overlayTag.textContent = "MISSION CONTROL";
    ui.overlayTitle.innerHTML = 'MISSION <span class="accent">PAUSED</span>';
    ui.overlayText.textContent = "Take a breath, pilot. Resume when ready.";
    ui.overlayBtn.textContent = "RESUME MISSION";
    ui.status.textContent = "PAUSED";
    ui.pauseBtn.textContent = "RESUME GAME";
    cancelAnimationFrame(animationId);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false; running = true;
    ui.overlay.classList.add("hidden");
    ui.status.textContent = "ACTIVE";
    ui.pauseBtn.textContent = "PAUSE GAME";
    lastTime = performance.now();
    animationId = requestAnimationFrame(loop);
  }

  function finishGame(won) {
    running = false; paused = false; pointer.down = false;
    gameOver = !won; campaignComplete = won;
    if (score > best) { best = score; saveNumber("cyberstrike-best", best); }
    updateHUD();
    ui.pauseBtn.disabled = true;
    ui.overlay.classList.remove("hidden");
    if (won) {
      ui.status.textContent = "CAMPAIGN COMPLETE";
      ui.overlayTag.textContent = "ALL MISSIONS CLEARED";
      ui.overlayTitle.innerHTML = 'CORE <span class="accent">DESTROYED</span>';
      ui.overlayText.textContent = `Campaign complete! Score: ${score}. Eliminations: ${kills}. Best score: ${best}.`;
      ui.overlayBtn.textContent = "PLAY AGAIN →";
      saveNumber("cyberstrike-unlocked", MAX_LEVEL);
      beep(740, 0.25, "triangle", 0.05);
    } else {
      ui.status.textContent = "MISSION FAILED";
      ui.overlayTag.textContent = `LEVEL ${String(level).padStart(2, "0")} // SYSTEM FAILURE`;
      ui.overlayTitle.innerHTML = 'MISSION <span style="color:#ff4da6">FAILED</span>';
      ui.overlayText.textContent = `Score: ${score} · Eliminations: ${kills}. Recalibrate and try again.`;
      ui.overlayBtn.textContent = "RETRY CAMPAIGN →";
      beep(130, 0.3, "sawtooth", 0.035);
    }
    ui.startBtn.textContent = "RESTART CAMPAIGN";
  }

  function nextLevel() {
    level++;
    wave = 1; elapsed = 0;
    bullets = []; enemies = []; particles = []; pickups = []; boss = null;
    spawnClock = 0; shotClock = 0; damageClock = 0; pickupClock = 8;
    window._waveSpawned = 0;
    player.x = W / 2; player.y = H / 2;
    player.health = Math.min(100, player.health + 25);
    weaponIndex = Math.min(2, weaponIndex + 1);
    updateWeaponUI(); updateHUD();
    showToast(`LEVEL ${level} // ${level === 2 ? "CYBER FACTORY" : "THE CORE"}`);
    if (level > unlockedLevel) { unlockedLevel = level; saveNumber("cyberstrike-unlocked", unlockedLevel); }
    running = true; paused = false;
    ui.overlay.classList.add("hidden");
    ui.status.textContent = "ACTIVE";
    ui.pauseBtn.disabled = false; ui.pauseBtn.textContent = "PAUSE GAME";
    lastTime = performance.now();
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(loop);
  }

  function completeLevel() {
    running = false;
    if (score > best) { best = score; saveNumber("cyberstrike-best", best); }
    if (level >= MAX_LEVEL) { finishGame(true); return; }
    ui.status.textContent = "LEVEL COMPLETE";
    ui.pauseBtn.disabled = true;
    ui.overlay.classList.remove("hidden");
    ui.overlayTag.textContent = `MISSION ${String(level).padStart(3, "0")} // CLEARED`;
    ui.overlayTitle.innerHTML = 'LEVEL <span class="accent">COMPLETE</span>';
    ui.overlayText.textContent = `Level ${level} cleared. Score: ${score}. Your armor receives a 25-point repair on the next deployment.`;
    ui.overlayBtn.textContent = `DEPLOY TO LEVEL ${level + 1} →`;
    ui.startBtn.textContent = "RESTART CAMPAIGN";
    if (level + 1 > unlockedLevel) { unlockedLevel = level + 1; saveNumber("cyberstrike-unlocked", unlockedLevel); }
    beep(620, 0.15, "triangle", 0.04);
  }

  function spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = rand(0, W); y = -24; }
    else if (side === 1) { x = W + 24; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = H + 24; }
    else { x = -24; y = rand(0, H); }
    const heavy = level >= 2 && Math.random() < 0.24;
    const health = heavy ? 3 : 1;
    enemies.push({
      x, y, radius: heavy ? 18 : 12,
      speed: (heavy ? 56 : 78) + rand(0, 22) + (level - 1) * 12 + (wave - 1) * 4,
      health, maxHealth: health, damage: heavy ? 18 : 10,
      color: heavy ? "#ff4da6" : "#ff657a", type: heavy ? "heavy" : "drone"
    });
  }

  function spawnBoss() {
    boss = {
      x: W / 2, y: 105, radius: 37,
      health: 65 + level * 25, maxHealth: 65 + level * 25,
      speed: 60 + level * 10, direction: 1, shotTimer: 1.2, touchTimer: 0
    };
    showToast("BOSS DETECTED // CORE ONLINE");
    beep(100, 0.35, "sawtooth", 0.04);
  }

  function spawnPickup() {
    const roll = Math.random();
    pickups.push({
      x: rand(55, W - 55), y: rand(55, H - 55),
      radius: 11, type: roll < 0.55 ? "health" : roll < 0.8 ? "shield" : "rapid",
      life: 10
    });
  }

  function shoot() {
    if (shotClock > 0) return;
    const weapon = weapons[weaponIndex];
    shotClock = weapon.delay;
    for (let i = 0; i < weapon.count; i++) {
      const offset = weapon.count === 1 ? 0 : (i - 1) * weapon.spread;
      const angle = player.angle + offset;
      const distance = player.radius + 9;
      bullets.push({
        x: player.x + Math.cos(angle) * distance,
        y: player.y + Math.sin(angle) * distance,
        vx: Math.cos(angle) * weapon.speed,
        vy: Math.sin(angle) * weapon.speed,
        radius: weaponIndex === 2 ? 4.5 : 3.5, damage: weapon.damage, life: 1.35
      });
    }
    burst(player.x + Math.cos(player.angle) * 21, player.y + Math.sin(player.angle) * 21, "#35f2e5", 2, 45);
    beep(weaponIndex === 1 ? 620 : weaponIndex === 2 ? 240 : 420, 0.035, "square", 0.012);
  }

  function burst(x, y, color, count = 8, speed = 130) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.25 + Math.random() * 0.75);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.2, 0.55), maxLife: 0.55, size: rand(1, 4), color });
    }
  }

  function takeDamage(amount) {
    if (player.invulnerable > 0) return;
    if (player.shield > 0) {
      player.shield = Math.max(0, player.shield - amount);
      showToast("SHIELD ABSORBED DAMAGE");
    } else {
      player.health = Math.max(0, player.health - amount);
    }
    player.invulnerable = 0.55;
    burst(player.x, player.y, "#ff4da6", 10, 160);
    beep(160, 0.08, "sawtooth", 0.025);
    if (player.health <= 0) { updateHUD(); finishGame(false); }
  }

  function update(dt) {
    elapsed += dt;
    shotClock = Math.max(0, shotClock - dt);
    damageClock = Math.max(0, damageClock - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.shield = Math.max(0, player.shield - dt);
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove("show"); }

    let dx = 0, dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy--;
    if (keys.has("s") || keys.has("arrowdown")) dy++;
    if (keys.has("a") || keys.has("arrowleft")) dx--;
    if (keys.has("d") || keys.has("arrowright")) dx++;
    const len = Math.hypot(dx, dy) || 1;
    player.x = clamp(player.x + dx / len * player.speed * dt, player.radius, W - player.radius);
    player.y = clamp(player.y + dy / len * player.speed * dt, player.radius, H - player.radius);
    player.angle = Math.atan2(pointer.y - player.y, pointer.x - player.x);
    if (pointer.down || keys.has(" ")) shoot();

    // Each wave has a fixed enemy quota. Later levels end with a boss.
    const quota = 5 + level * 2 + wave * 2;
    spawnClock += dt;
    const interval = Math.max(0.38, 1.05 - level * 0.12 - wave * 0.04);

    if (spawnClock >= interval && enemies.length < 24 && !boss && window._waveSpawned < quota) {
      spawnClock = 0;
      spawnEnemy();
      window._waveSpawned++;
    }

    if (window._waveSpawned >= quota && enemies.length === 0 && !boss) {
      if (wave < WAVES_PER_LEVEL) {
        wave++;
        window._waveSpawned = 0;
        spawnClock = 0;
        showToast(`WAVE ${wave} // INCOMING`);
        burst(W / 2, H / 2, "#35f2e5", 18, 100);
      } else if (level === 1) {
        completeLevel();
        return;
      } else {
        spawnBoss();
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) bullets.splice(i, 1);
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      e.x += Math.cos(a) * e.speed * dt; e.y += Math.sin(a) * e.speed * dt;
      if (Math.hypot(player.x - e.x, player.y - e.y) < player.radius + e.radius) takeDamage(e.damage);
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < b.radius + e.radius) {
          bullets.splice(j, 1); e.health -= b.damage;
          burst(b.x, b.y, e.color, 3, 65);
          if (e.health <= 0) {
            burst(e.x, e.y, e.color, 13, 155);
            enemies.splice(i, 1); score += e.maxHealth > 1 ? 25 : 10; kills++;
            if (Math.random() < 0.12) pickups.push({ x: e.x, y: e.y, radius: 11, type: Math.random() < 0.6 ? "health" : "shield", life: 10 });
            break;
          }
          break;
        }
      }
      if (!running) return;
    }

    // Boss moves horizontally and fires aimed projectiles.
    if (boss) {
      boss.x += boss.speed * boss.direction * dt;
      if (boss.x > W - boss.radius - 15) boss.direction = -1;
      if (boss.x < boss.radius + 15) boss.direction = 1;
      boss.shotTimer -= dt;
      boss.touchTimer = Math.max(0, boss.touchTimer - dt);
      if (boss.shotTimer <= 0) {
        boss.shotTimer = Math.max(0.65, 1.35 - level * 0.12);
        const a = Math.atan2(player.y - boss.y, player.x - boss.x);
        bullets.push({ x: boss.x, y: boss.y + boss.radius * 0.65, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, radius: 7, damage: 0, hostile: true, life: 4 });
        burst(boss.x, boss.y + boss.radius, "#ff4da6", 5, 65);
      }
      if (Math.hypot(player.x - boss.x, player.y - boss.y) < player.radius + boss.radius && boss.touchTimer <= 0) {
        boss.touchTimer = 0.8; takeDamage(18);
      }
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (b.hostile) {
          if (Math.hypot(player.x - b.x, player.y - b.y) < player.radius + b.radius) {
            bullets.splice(j, 1); takeDamage(12);
          }
        } else if (Math.hypot(b.x - boss.x, b.y - boss.y) < b.radius + boss.radius) {
          bullets.splice(j, 1); boss.health -= b.damage;
          burst(b.x, b.y, "#ff4da6", 3, 70);
          if (boss.health <= 0) {
            score += 250; kills++; burst(boss.x, boss.y, "#ff4da6", 45, 220); boss = null;
            if (level < MAX_LEVEL) completeLevel(); else finishGame(true);
            return;
          }
        }
      }
    }

    // Power-ups: health, shield, and rapid-fire.
    pickupClock -= dt;
    if (pickupClock <= 0 && pickups.length < 3) { spawnPickup(); pickupClock = rand(10, 16); }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i]; p.life -= dt;
      if (p.life <= 0) { pickups.splice(i, 1); continue; }
      if (Math.hypot(player.x - p.x, player.y - p.y) < player.radius + p.radius) {
        if (p.type === "health") { player.health = Math.min(100, player.health + 25); showToast("HEALTH RESTORED +25"); }
        else if (p.type === "shield") { player.shield = 6; showToast("SHIELD ACTIVE // 6 SEC"); }
        else { weaponIndex = 1; updateWeaponUI(); showToast("RAPID BLASTER PICKED UP"); }
        burst(p.x, p.y, p.type === "health" ? "#35f2e5" : "#ff4da6", 12, 120);
        pickups.splice(i, 1); beep(700, 0.12, "triangle", 0.035);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 2 * dt); p.vy *= Math.max(0, 1 - 2 * dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    updateHUD();
  }

  function drawGrid() {
    ctx.fillStyle = "#080d18"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#18263a"; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = "#284356"; ctx.strokeRect(8, 8, W - 16, H - 16);
  }

  function drawPlayer() {
    if (!player) return;
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.angle);
    if (player.invulnerable > 0 && Math.floor(elapsed * 18) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.shadowBlur = 20; ctx.shadowColor = "#35f2e5"; ctx.fillStyle = "#bffffa"; ctx.fillRect(0, -4, 25, 8);
    ctx.fillStyle = "#35f2e5"; ctx.beginPath(); ctx.arc(0, 0, player.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#09202b"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (player.shield > 0) {
      ctx.save(); ctx.strokeStyle = "#7c9cff"; ctx.lineWidth = 3; ctx.shadowBlur = 18; ctx.shadowColor = "#7c9cff";
      ctx.beginPath(); ctx.arc(player.x, player.y, player.radius + 8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  function drawBullets() {
    ctx.save();
    for (const b of bullets) {
      ctx.fillStyle = b.hostile ? "#ff4da6" : "#bffffa";
      ctx.shadowColor = b.hostile ? "#ff4da6" : "#35f2e5"; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      ctx.save(); ctx.fillStyle = e.color; ctx.strokeStyle = "#ffb1d8"; ctx.lineWidth = 2;
      ctx.shadowColor = e.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#310d26"; ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
      if (e.maxHealth > 1) {
        ctx.shadowBlur = 0; ctx.fillStyle = "#442034"; ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, e.radius * 2, 3);
        ctx.fillStyle = e.color; ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, e.radius * 2 * e.health / e.maxHealth, 3);
      }
      ctx.restore();
    }
  }

  function drawBoss() {
    if (!boss) return;
    ctx.save(); ctx.translate(boss.x, boss.y);
    ctx.fillStyle = "#38112c"; ctx.strokeStyle = "#ff4da6"; ctx.lineWidth = 4;
    ctx.shadowColor = "#ff4da6"; ctx.shadowBlur = 28;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 - Math.PI / 8;
      const r = i % 2 === 0 ? boss.radius : boss.radius * 0.78;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff4da6"; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Boss health bar
    const bw = 170, bx = boss.x - bw / 2, by = boss.y - boss.radius - 16;
    ctx.fillStyle = "#401b33"; ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = "#ff4da6"; ctx.fillRect(bx, by, bw * Math.max(0, boss.health / boss.maxHealth), 6);
  }

  function drawPickups() {
    for (const p of pickups) {
      ctx.save();
      const color = p.type === "health" ? "#35f2e5" : p.type === "shield" ? "#7c9cff" : "#ffce5c";
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 16; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.stroke();
      if (p.type === "health") {
        ctx.fillRect(p.x - 2, p.y - 6, 4, 12); ctx.fillRect(p.x - 6, p.y - 2, 12, 4);
      } else if (p.type === "shield") {
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 5, p.y - 2); ctx.lineTo(p.x + 4, p.y + 4); ctx.lineTo(p.x, p.y + 7); ctx.lineTo(p.x - 4, p.y + 4); ctx.lineTo(p.x - 5, p.y - 2); ctx.closePath(); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(p.x - 5, p.y - 6); ctx.lineTo(p.x + 1, p.y - 1); ctx.lineTo(p.x - 1, p.y + 1); ctx.lineTo(p.x + 5, p.y + 6); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    drawGrid(); drawPickups(); drawParticles(); drawBullets(); drawEnemies(); drawBoss(); drawPlayer();
  }

  function loop(timestamp) {
    if (!running) return;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
    lastTime = timestamp;
    update(dt);
    draw();
    if (running) animationId = requestAnimationFrame(loop);
  }

  function changeWeapon(index) {
    if (index < 0 || index >= weapons.length) return;
    weaponIndex = index; updateWeaponUI(); showToast(`${weapons[index].name} EQUIPPED`);
    beep(500 + index * 100, 0.06);
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) * W / rect.width;
    pointer.y = (event.clientY - rect.top) * H / rect.height;
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 0) { pointer.down = true; if (audioContext && audioContext.state === "suspended") audioContext.resume(); }
  });
  window.addEventListener("pointerup", () => { pointer.down = false; });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    keys.add(key);
    if (key === "escape") { if (running) pauseGame(); else if (paused) resumeGame(); }
    if (key === "1") changeWeapon(0);
    if (key === "2") changeWeapon(1);
    if (key === "3") changeWeapon(2);
    if (key === "enter" && !running && !paused) {
      if (ui.overlayBtn.textContent.includes("LEVEL")) nextLevel();
      else startMission();
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => { keys.clear(); pointer.down = false; if (running) pauseGame(); });

  ui.startBtn.addEventListener("click", () => { if (running || paused) { resetCampaign(); startMission(); } else startMission(); });
  ui.overlayBtn.addEventListener("click", () => {
    if (paused) { resumeGame(); return; }
    if (ui.status.textContent === "LEVEL COMPLETE" && level < MAX_LEVEL) { nextLevel(); return; }
    if (gameOver || campaignComplete) { resetCampaign(); startMission(); return; }
    startMission();
  });
  ui.pauseBtn.addEventListener("click", () => paused ? resumeGame() : pauseGame());
  ui.soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    ui.soundBtn.textContent = soundOn ? "SOUND: ON" : "SOUND: OFF";
    if (soundOn) beep(600, 0.08);
  });

  // Initialize a fresh campaign state.
  initState();
  draw();
})();

function updateLoadoutUI() {
  document.querySelectorAll(".loadout-option").forEach((button) => {
    const selected = Number(button.dataset.weapon) === weaponIndex;

    button.classList.toggle("selected", selected);

    const status = button.querySelector(".weapon-status");
    if (status) {
      status.textContent = selected ? "EQUIPPED" : "SELECT";
    }

    button.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelectorAll(".loadout-option").forEach((button) => {
  button.addEventListener("click", () => {
    changeWeapon(Number(button.dataset.weapon));
    updateLoadoutUI();
  });
});

updateLoadoutUI();
