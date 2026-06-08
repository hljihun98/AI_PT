/**
 * app.js  v2.0
 * 메인 애플리케이션 오케스트레이터
 * - 운동 선택 메뉴 (카테고리별 + 자동모드)
 * - 일시정지 / 재개 / 세션종료 버그 수정
 * - 운동 정보 모달
 * - 음성 피드백
 */

class App {
  constructor() {
    this.poseEngine            = null;
    this.exerciseRecognition   = null;
    this.biomechanicsEngine    = null;
    this.riskEngine            = null;
    this.dashboard             = null;
    this.exerciseDB            = null;

    /* ── 세션 상태 ── */
    this.state = {
      isRunning      : false,   // 카메라 + 분석 실행 중
      isPaused       : false,   // 일시정지
      sessionActive  : false,   // 세션이 열려 있는지
      currentView    : 'select',// 'select' | 'info' | 'workout' | 'dashboard'
      cameraMode     : 'user',
      weightInput    : 0,
      showSkeleton   : true,
      showAngles     : false,
      voiceEnabled   : true,
      autoDetect     : false,   // 자동 감지 모드
      selectedExercise: null,   // 수동 선택 시 exerciseId
    };

    /* ── 타이머 ── */
    this.sessionTimer        = null;
    this.sessionStartTime    = null;
    this.pausedElapsed       = 0;    // 일시정지 이전까지 누적 경과시간(ms)
    this.pauseStartTime      = null;

    /* ── 음성 ── */
    this.speechSynthesis     = window.speechSynthesis;
    this.lastVoiceFeedback   = 0;
    this.VOICE_COOLDOWN      = 4000;

    /* ── 카운트 ── */
    this.currentFormScore    = 0;
    this.repCount            = 0;
    this.setCount            = 0;

    /* ── DOM ── */
    this.canvas              = null;
    this.ctx                 = null;
    this.videoElement        = null;

    this.feedbackDisplayTime = 3000;
  }

  /* ═══════════════════════════════════════
     초기화
  ═══════════════════════════════════════ */
  async initialize() {
    // DB 로드
    try {
      const r = await fetch('./exercise_database.json');
      this.exerciseDB = await r.json();
    } catch (e) {
      this.exerciseDB = { exercises: {}, muscleGroups: {}, categories: {} };
    }

    // 엔진 초기화
    this.poseEngine          = window.poseEngine;
    this.exerciseRecognition = new ExerciseRecognition(this.exerciseDB);
    this.biomechanicsEngine  = new BiomechanicsEngine(this.exerciseDB);
    this.riskEngine          = new RiskEngine(this.exerciseDB);
    this.dashboard           = new Dashboard();

    this.videoElement = document.getElementById('videoElement');
    this.canvas       = document.getElementById('poseCanvas');
    this.ctx          = this.canvas?.getContext('2d');

    this._setupCallbacks();
    this._setupEventListeners();

    await this.dashboard.initialize();

    const ok = await this.poseEngine.initialize();
    if (!ok) { this._showError('MediaPipe 초기화 실패. 인터넷 연결을 확인해주세요.'); return; }

    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    // 운동 선택 화면 렌더링
    this._renderSelectView();
    this._showView('select');
  }

  /* ═══════════════════════════════════════
     뷰 전환
  ═══════════════════════════════════════ */
  _showView(name) {
    ['select','info','workout','dashboard'].forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.toggle('hidden', v !== name);
    });
    this.state.currentView = name;

    // nav 버튼 active
    document.getElementById('navBtnWorkout')?.classList.toggle('active', name === 'workout' || name === 'select' || name === 'info');
    document.getElementById('navBtnDashboard')?.classList.toggle('active', name === 'dashboard');
  }

  showDashboard() {
    this._showView('dashboard');
    this.dashboard.renderDashboard('dashboardContainer');
  }
  showWorkout() { this._showView(this.state.sessionActive ? 'workout' : 'select'); }

  /* ═══════════════════════════════════════
     운동 선택 화면 렌더링
  ═══════════════════════════════════════ */
  _renderSelectView() {
    const container = document.getElementById('selectViewContent');
    if (!container || !this.exerciseDB) return;

    const cats  = this.exerciseDB.categories || {};
    const exers = this.exerciseDB.exercises  || {};

    // 카테고리별 그룹핑
    const grouped = {};
    Object.values(exers).forEach(ex => {
      if (!grouped[ex.category]) grouped[ex.category] = [];
      grouped[ex.category].push(ex);
    });

    let html = `
      <!-- 자동 감지 모드 -->
      <div class="select-auto-card" id="autoModeCard">
        <div class="auto-card-inner">
          <div class="auto-icon">🤖</div>
          <div>
            <div class="auto-title">AI 자동 감지 모드</div>
            <div class="auto-desc">카메라가 운동 종류를 자동으로 인식합니다</div>
          </div>
          <button class="btn btn-primary" onclick="app.startAutoMode()">자동 시작</button>
        </div>
      </div>

      <div class="select-divider"><span>또는 운동을 직접 선택하세요</span></div>
    `;

    // 카테고리 탭
    html += `<div class="category-tabs" id="categoryTabs">`;
    Object.entries(cats).forEach(([catId, cat], i) => {
      html += `<button class="cat-tab ${i===0?'active':''}" data-cat="${catId}" onclick="app._filterCategory('${catId}', this)">
        ${cat.icon} ${cat.name}
      </button>`;
    });
    html += `</div>`;

    // 운동 카드 그리드
    html += `<div class="exercise-grid" id="exerciseGrid">`;
    Object.values(exers).forEach(ex => {
      const cat = cats[ex.category] || {};
      const diffLabel = { beginner:'초급', intermediate:'중급', advanced:'고급' }[ex.difficulty] || ex.difficulty;
      const diffColor = { beginner:'#00ff88', intermediate:'#ffd700', advanced:'#ff4444' }[ex.difficulty] || '#aaa';
      html += `
        <div class="exercise-card" data-cat="${ex.category}" onclick="app._showExerciseInfo('${ex.id}')">
          <div class="ex-card-emoji">${ex.emoji || '💪'}</div>
          <div class="ex-card-name">${ex.name}</div>
          <div class="ex-card-muscles">${(ex.targetMuscles||[]).slice(0,2).join(' · ')}</div>
          <div class="ex-card-footer">
            <span class="ex-cat-badge" style="color:${cat.color||'#aaa'}">${cat.icon||''} ${cat.name||ex.category}</span>
            <span class="ex-diff-badge" style="color:${diffColor}">${diffLabel}</span>
          </div>
        </div>`;
    });
    html += `</div>`;

    container.innerHTML = html;

    // 첫 번째 카테고리 필터 적용
    const firstCat = Object.keys(cats)[0];
    if (firstCat) this._filterCategory(firstCat, document.querySelector('.cat-tab'));
  }

  _filterCategory(catId, btn) {
    // 탭 active
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    btn?.classList.add('active');

    // 카드 필터
    document.querySelectorAll('.exercise-card').forEach(card => {
      card.style.display = (catId === 'all' || card.dataset.cat === catId) ? 'flex' : 'none';
    });
  }

  /* ═══════════════════════════════════════
     운동 정보 모달
  ═══════════════════════════════════════ */
  _showExerciseInfo(exerciseId) {
    const ex  = this.exerciseDB.exercises[exerciseId];
    const cat = this.exerciseDB.categories[ex?.category] || {};
    if (!ex) return;

    const container = document.getElementById('infoViewContent');
    const diffLabel = { beginner:'초급', intermediate:'중급', advanced:'고급' }[ex.difficulty] || '';
    const diffColor = { beginner:'#00ff88', intermediate:'#ffd700', advanced:'#ff4444' }[ex.difficulty] || '#aaa';

    container.innerHTML = `
      <div class="info-header">
        <button class="btn btn-neutral" onclick="app._showView('select')" style="padding:6px 12px; font-size:11px;">← 목록</button>
        <div class="info-title-row">
          <span class="info-emoji">${ex.emoji || '💪'}</span>
          <div>
            <h2 class="info-name">${ex.name}</h2>
            <div class="info-meta">
              <span style="color:${cat.color||'#aaa'}">${cat.icon||''} ${cat.name||''}</span>
              <span style="color:${diffColor}">● ${diffLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="info-grid">

        <div class="info-card">
          <div class="info-card-title">🎯 운동 목적</div>
          <p class="info-card-body">${ex.purpose || '-'}</p>
        </div>

        <div class="info-card">
          <div class="info-card-title">💪 주요 자극 부위</div>
          <div class="muscle-tags">
            ${(ex.targetMuscles||[]).map(m=>`<span class="muscle-tag">${m}</span>`).join('')}
          </div>
        </div>

        <div class="info-card">
          <div class="info-card-title">✨ 기대 효과</div>
          <ul class="info-list">
            ${(ex.benefits||[]).map(b=>`<li>${b}</li>`).join('')}
          </ul>
        </div>

        <div class="info-card">
          <div class="info-card-title">📋 올바른 운동 방법</div>
          <ol class="info-list ordered">
            ${(ex.instructions||[]).map(s=>`<li>${s}</li>`).join('')}
          </ol>
        </div>

        <div class="info-card caution-card">
          <div class="info-card-title">⚠️ 주의사항</div>
          <ul class="info-list">
            ${(ex.cautions||[]).map(c=>`<li>${c}</li>`).join('')}
          </ul>
        </div>

      </div>

      <div class="info-start-row">
        <button class="btn btn-primary info-start-btn" onclick="app.startWithExercise('${ex.id}')">
          ▶ 이 운동 시작하기
        </button>
      </div>
    `;

    this._showView('info');
  }

  /* ═══════════════════════════════════════
     자동 모드 시작
  ═══════════════════════════════════════ */
  async startAutoMode() {
    this.state.autoDetect       = true;
    this.state.selectedExercise = null;
    await this._beginSession();
  }

  /* ═══════════════════════════════════════
     특정 운동 선택 후 시작
  ═══════════════════════════════════════ */
  async startWithExercise(exerciseId) {
    this.state.autoDetect        = false;
    this.state.selectedExercise  = exerciseId;

    // 운동 인식 엔진에 강제 설정
    this.exerciseRecognition.forceExercise(exerciseId);

    await this._beginSession();
  }

  /* ═══════════════════════════════════════
     세션 시작 공통 로직
  ═══════════════════════════════════════ */
  async _beginSession() {
    this._showView('workout');

    // 운동 이름 표시
    if (!this.state.autoDetect && this.state.selectedExercise) {
      const ex = this.exerciseDB.exercises[this.state.selectedExercise];
      const el = document.getElementById('detectedExercise');
      if (el && ex) { el.textContent = ex.name; el.style.color = '#00f5ff'; }
    }

    // 카메라 시작
    const ok = await this.poseEngine.startCamera(this.videoElement, this.state.cameraMode);
    if (!ok) { this._showError('카메라 접근 권한이 필요합니다.'); this._showView('select'); return; }

    this.state.isRunning    = true;
    this.state.isPaused     = false;
    this.state.sessionActive= true;
    this.pausedElapsed      = 0;
    this.sessionStartTime   = Date.now();

    this.dashboard.startSession();
    this.exerciseRecognition.resetSession();
    if (!this.state.autoDetect && this.state.selectedExercise) {
      this.exerciseRecognition.forceExercise(this.state.selectedExercise);
    }

    this._startSessionTimer();
    this._updatePauseResumeBtn();
    this._updateStatus('분석 중...');
    this._speakFeedback('운동을 시작합니다. 카메라 앞에 서주세요.');
  }

  /* ═══════════════════════════════════════
     일시정지 / 재개  ← 핵심 버그 수정
  ═══════════════════════════════════════ */
  pauseWorkout() {
    if (!this.state.isRunning || this.state.isPaused) return;

    this.state.isPaused  = true;
    this.state.isRunning = false;
    this.pauseStartTime  = Date.now();

    // 타이머 정지
    clearInterval(this.sessionTimer);
    this.sessionTimer = null;

    // 카메라 피드 일시정지 (pose 처리 중단)
    this.poseEngine.isRunning = false;

    this._updatePauseResumeBtn();
    this._updateStatus('일시정지됨');
    this._clearCanvas();
  }

  resumeWorkout() {
    if (!this.state.isPaused) return;

    // 일시정지 시간 누적
    if (this.pauseStartTime) {
      this.pausedElapsed += Date.now() - this.pauseStartTime;
      this.pauseStartTime = null;
    }

    this.state.isPaused  = false;
    this.state.isRunning = true;

    // 카메라 피드 재개
    this.poseEngine.isRunning = true;

    // 타이머 재시작
    this._startSessionTimer();
    this._updatePauseResumeBtn();
    this._updateStatus('분석 중...');
    this._speakFeedback('운동을 재개합니다.');
  }

  togglePause() {
    if (this.state.isPaused) this.resumeWorkout();
    else this.pauseWorkout();
  }

  _updatePauseResumeBtn() {
    const btn = document.getElementById('btnPauseResume');
    if (!btn) return;
    btn.textContent = this.state.isPaused ? '▶ 재개' : '⏸ 일시정지';
    btn.className   = this.state.isPaused ? 'btn btn-primary' : 'btn btn-neutral';
  }

  /* ═══════════════════════════════════════
     세션 종료  ← 핵심 버그 수정
  ═══════════════════════════════════════ */
  async endSession() {
    // 1. 카메라 완전 정지
    this.state.isRunning     = false;
    this.state.isPaused      = false;
    this.state.sessionActive = false;
    this.poseEngine.isRunning = false;

    await this.poseEngine.stopCamera();

    // 2. 타이머 정지
    clearInterval(this.sessionTimer);
    this.sessionTimer    = null;
    this.sessionStartTime = null;
    this.pausedElapsed    = 0;

    // 3. 음성 합성 정지
    this.speechSynthesis?.cancel();

    // 4. 캔버스 클리어
    this._clearCanvas();

    // 5. DB 세션 저장
    const sessionData = await this.dashboard.endSession();

    // 6. 피드백
    if (sessionData) {
      const sets = sessionData.sets?.length || 0;
      const reps = sessionData.totalReps   || 0;
      this._speakFeedback(`운동 완료! 총 ${sets}세트, ${reps}회 수행했습니다.`);
    }

    // 7. 상태 초기화
    this.repCount = 0;
    this.setCount = 0;
    this.exerciseRecognition.resetSession();
    this._updateTimerDisplay(0);

    // 8. 대시보드로 이동
    this.showDashboard();
  }

  /* ═══════════════════════════════════════
     카메라 전환
  ═══════════════════════════════════════ */
  async flipCamera() {
    this.state.cameraMode = this.state.cameraMode === 'user' ? 'environment' : 'user';
    if (this.state.isRunning || this.state.sessionActive) {
      await this.poseEngine.startCamera(this.videoElement, this.state.cameraMode);
    }
  }

  /* ═══════════════════════════════════════
     타이머
  ═══════════════════════════════════════ */
  _startSessionTimer() {
    clearInterval(this.sessionTimer);
    this.sessionTimer = setInterval(() => {
      if (this.state.isPaused) return;
      const elapsed = (Date.now() - this.sessionStartTime) - this.pausedElapsed;
      this._updateTimerDisplay(elapsed);
    }, 500);
  }

  _updateTimerDisplay(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const el = document.getElementById('sessionTimer');
    if (el) el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  /* ═══════════════════════════════════════
     포즈 감지 메인 처리
  ═══════════════════════════════════════ */
  _setupCallbacks() {
    this.poseEngine.onPoseDetected = (poseData) => {
      if (!this.state.isRunning || this.state.isPaused) return;
      this._onPoseDetected(poseData);
    };

    this.poseEngine.onError = (err) => this._showError('카메라 오류: ' + err.message);

    this.exerciseRecognition.onExerciseDetected = (d) => this._onExerciseDetected(d);
    this.exerciseRecognition.onRepCounted       = (d) => this._onRepCounted(d);
    this.exerciseRecognition.onSetComplete      = (d) => this._onSetComplete(d);

    this.biomechanicsEngine.onFatigueAlert = (d) => this._onFatigueDetected(d);
    this.riskEngine.onRiskDetected         = (d) => this._onRiskDetected(d);
  }

  _setupEventListeners() {
    document.getElementById('btnPauseResume')?.addEventListener('click', () => this.togglePause());
    document.getElementById('btnEndSession') ?.addEventListener('click', () => this.endSession());
    document.getElementById('btnCompleteSet')?.addEventListener('click', () => this.completeCurrentSet());
    document.getElementById('btnCameraFlip') ?.addEventListener('click', () => this.flipCamera());
    document.getElementById('btnVoice')      ?.addEventListener('click', () => this.toggleVoice());
    document.getElementById('btnSkeleton')   ?.addEventListener('click', () => this.toggleSkeleton());
    document.getElementById('btnAngles')     ?.addEventListener('click', () => {
      this.state.showAngles = !this.state.showAngles;
      document.getElementById('btnAngles')?.classList.toggle('active', this.state.showAngles);
    });
    document.getElementById('weightInput')?.addEventListener('change', (e) => {
      this.state.weightInput = parseFloat(e.target.value) || 0;
    });
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space')  { e.preventDefault(); this.completeCurrentSet(); }
      if (e.code === 'KeyP')   this.togglePause();
      if (e.code === 'KeyR')   this.resetReps();
      if (e.code === 'KeyV')   this.toggleVoice();
    });
  }

  _onPoseDetected(poseData) {
    const { landmarks, angles, metrics } = poseData;

    // 운동 감지 (자동 모드만)
    let detection = null;
    if (this.state.autoDetect) {
      detection = this.exerciseRecognition.detectExercise(poseData);
    }

    // 반복 감지
    const currentEx = this.exerciseRecognition.currentExercise;
    if (currentEx) {
      this.exerciseRecognition.detectRep(angles);
    }

    // 자세 분석
    let formScore = null, riskAssessment = null;
    if (currentEx) {
      formScore      = this.biomechanicsEngine.calculateFormScore(poseData, currentEx);
      riskAssessment = this.riskEngine.assessRisk(poseData, currentEx);
      this.currentFormScore = formScore.total;
      this._processFeedback(formScore, riskAssessment);
    }

    // 캔버스 그리기
    if (this.canvas && this.ctx && this.state.showSkeleton) {
      this._drawFrame(landmarks, angles, formScore, riskAssessment);
    }

    this._updateRealTimeUI(formScore, riskAssessment, detection);
  }

  _drawFrame(landmarks, angles, formScore, riskAssessment) {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (landmarks) {
      this.poseEngine.drawPose(ctx, landmarks, formScore?.total ?? null);
      if (this.state.showAngles && angles) this._drawAngles(ctx, landmarks, angles);
      if (riskAssessment?.risks?.length) this._drawRiskHighlights(ctx, landmarks, riskAssessment.risksByJoint);
    }
    this._drawRepCounter(ctx, w, h);
  }

  _drawAngles(ctx, landmarks, angles) {
    const w = this.canvas.width, h = this.canvas.height;
    const L = this.poseEngine.LANDMARKS;
    const pairs = [
      [L.RIGHT_ELBOW, angles.rightElbow, 'R팔꿈치'],
      [L.LEFT_ELBOW,  angles.leftElbow,  'L팔꿈치'],
      [L.RIGHT_KNEE,  angles.rightKnee,  'R무릎'],
      [L.LEFT_KNEE,   angles.leftKnee,   'L무릎'],
      [L.RIGHT_HIP,   angles.rightHip,   'R고관절'],
    ];
    ctx.font = 'bold 12px monospace';
    pairs.forEach(([idx, angle, label]) => {
      if (angle == null) return;
      const lm = landmarks[idx];
      if (!lm || lm.visibility < 0.5) return;
      const x = lm.x * w + 10, y = lm.y * h - 5;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 2, y - 14, 68, 18);
      ctx.fillStyle = angle > 90 ? '#00ffaa' : '#ffaa00';
      ctx.fillText(`${angle}°`, x, y);
    });
  }

  _drawRiskHighlights(ctx, landmarks, risksByJoint) {
    const w = this.canvas.width, h = this.canvas.height;
    const L = this.poseEngine.LANDMARKS;
    const map = {
      spine   : [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP],
      knee    : [L.LEFT_KNEE, L.RIGHT_KNEE],
      shoulder: [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
      hip     : [L.LEFT_HIP, L.RIGHT_HIP],
      ankle   : [L.LEFT_ANKLE, L.RIGHT_ANKLE]
    };
    for (const [joint, risks] of Object.entries(risksByJoint)) {
      const idxs = map[joint]; if (!idxs) continue;
      const maxSev = risks.reduce((mx, r) => {
        const order = {critical:4,high:3,medium:2,low:1};
        return order[r.severity] > order[mx] ? r.severity : mx;
      }, 'low');
      const score = maxSev==='critical'?90 : maxSev==='high'?65 : maxSev==='medium'?35 : 15;
      const color = this.riskEngine.getRiskColor(score);
      idxs.forEach(idx => {
        const lm = landmarks[idx];
        if (!lm || lm.visibility < 0.5) return;
        ctx.beginPath();
        ctx.arc(lm.x*w, lm.y*h, 15, 0, Math.PI*2);
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.shadowBlur = 15; ctx.shadowColor = color;
        ctx.stroke(); ctx.shadowBlur = 0;
      });
    }
  }

  _drawRepCounter(ctx, w, h) {
    const reps = this.exerciseRecognition.repCount;
    const ex   = this.exerciseRecognition.currentExercise;
    if (!ex) return;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(w - 115, 10, 105, 65);
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(reps, w - 14, 60);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px monospace';
    ctx.fillText('REPS', w - 14, 75);
    ctx.textAlign = 'left';
  }

  /* ── 피드백 ── */
  _processFeedback(formScore, riskAssessment) {
    const now = Date.now();
    if (riskAssessment) {
      const crit = riskAssessment.risks.find(r => r.severity === 'critical');
      if (crit && now - this.lastVoiceFeedback > 2000) {
        this._speakFeedback(crit.message, true);
        this._showFeedbackMessage(crit.message, 'critical');
        this.lastVoiceFeedback = now; return;
      }
    }
    if (now - this.lastVoiceFeedback > this.VOICE_COOLDOWN) {
      if (formScore?.feedback?.length) {
        const fb = formScore.feedback[0];
        this._speakFeedback(fb.message);
        this._showFeedbackMessage(fb.message, fb.type);
        this.lastVoiceFeedback = now;
      } else if (formScore?.total >= 85) {
        this._speakFeedback('현재 자세가 매우 안정적입니다! 계속하세요.');
        this.lastVoiceFeedback = now;
      }
    }
    if (formScore?.feedback?.length) {
      formScore.feedback.slice(0,2).forEach(fb => this._showFeedbackMessage(fb.message, fb.type));
    }
  }

  _speakFeedback(text, priority = false) {
    if (!this.state.voiceEnabled || !this.speechSynthesis) return;
    if (priority) this.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = 1.0; u.volume = 0.9;
    this.speechSynthesis.speak(u);
  }

  _showFeedbackMessage(message, type = 'info') {
    const c = document.getElementById('feedbackContainer');
    if (!c) return;
    if ([...c.querySelectorAll('.feedback-msg')].find(el => el.textContent.includes(message.slice(0,20)))) return;
    const el = document.createElement('div');
    el.className = `feedback-msg feedback-${type}`;
    el.textContent = message;
    c.appendChild(el);
    setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 500); }, this.feedbackDisplayTime);
    const msgs = c.querySelectorAll('.feedback-msg');
    if (msgs.length > 3) msgs[0].remove();
  }

  /* ── 이벤트 콜백들 ── */
  _onExerciseDetected(data) {
    if (!this.state.autoDetect) return;
    const el = document.getElementById('detectedExercise');
    if (el && data.exercise) { el.textContent = data.exercise.name; el.style.color = '#00ffff'; }
    const confEl = document.getElementById('exerciseConfidence');
    if (confEl) confEl.textContent = `${Math.round(data.confidence * 100)}%`;
    const bar = document.getElementById('confidenceBar');
    if (bar)   bar.style.width = Math.round(data.confidence * 100) + '%';
  }

  _onRepCounted(data) {
    this.repCount = data.count;
    const el = document.getElementById('repCounter');
    if (el) { el.textContent = data.count; el.classList.add('pulse'); setTimeout(()=>el.classList.remove('pulse'),300); }
    const qEl = document.getElementById('repQuality');
    if (qEl && data.quality != null) {
      qEl.textContent = data.quality + '점';
      qEl.style.color = data.quality>=80?'#00ff88':data.quality>=60?'#ffd700':'#ff4444';
    }
  }

  _onSetComplete(data) {
    this.setCount++;
    this.dashboard.addSet(data);
    const el = document.getElementById('setCounter');
    if (el) el.textContent = this.setCount;
    this._showFeedbackMessage(`${data.reps}회 완료! 자세 점수: ${data.averageQuality}점`, 'success');
    this._speakFeedback(`세트 완료! ${data.reps}회. 잠시 휴식하세요.`);
  }

  _onFatigueDetected(data) {
    const el = document.getElementById('fatigueIndicator');
    if (el) { el.textContent = data.level==='high'?'높음 ⚠️':'보통'; el.style.color = data.level==='high'?'#ff4444':'#ffa500'; }
    if (data.level === 'high') this._speakFeedback('피로도가 높습니다. 잠시 휴식을 취하세요.');
  }

  _onRiskDetected(data) {
    const el = document.getElementById('safetyScore');
    if (el) { const lb = this.riskEngine.getSafetyLabel(100 - data.risk.score); el.textContent = lb.label; el.style.color = lb.color; }
    this._speakFeedback(data.risk.message, true);
    this._showFeedbackMessage(data.risk.message, 'error');
  }

  /* ── 실시간 UI 업데이트 ── */
  _updateRealTimeUI(formScore, riskAssessment, detection) {
    if (formScore) {
      const scoreEl = document.getElementById('formScore');
      if (scoreEl) { scoreEl.textContent = formScore.total; scoreEl.style.color = formScore.total>=80?'#00ff88':formScore.total>=60?'#ffd700':'#ff4444'; }
      const gaugeEl = document.getElementById('scoreGauge');
      if (gaugeEl) { gaugeEl.style.width = formScore.total+'%'; gaugeEl.style.background = formScore.total>=80?'#00ff88':formScore.total>=60?'#ffd700':'#ff4444'; }
      const gradeEl = document.getElementById('formGrade');
      if (gradeEl && formScore.grade) { gradeEl.textContent = formScore.grade.grade; gradeEl.style.color = formScore.grade.color; }

      const c = formScore.components;
      [['score-posture',c.posture],['score-rangeOfMotion',c.rangeOfMotion],['score-stability',c.stability],['score-symmetry',c.symmetry],['score-tempo',c.tempo],['score-control',c.control]]
        .forEach(([id,v])=>{ const el=document.getElementById(id); if(el&&v!=null) el.style.width=v+'%'; });
      [['val-posture',c.posture],['val-rom',c.rangeOfMotion],['val-stability',c.stability],['val-symmetry',c.symmetry],['val-tempo',c.tempo]]
        .forEach(([id,v])=>{ const el=document.getElementById(id); if(el) el.textContent=v??'--'; });

      // AI 코치
      const coachEl = document.getElementById('aiCoachMessages');
      if (coachEl) {
        if (formScore.feedback?.length) {
          coachEl.textContent = formScore.feedback[0].message;
          coachEl.style.color = formScore.feedback[0].type==='error'?'var(--neon-red)':formScore.feedback[0].type==='warning'?'var(--neon-orange)':'var(--text-mid)';
        } else if (formScore.total>=85) { coachEl.textContent='✓ 자세가 안정적입니다. 계속 유지하세요!'; coachEl.style.color='var(--neon-green)'; }
      }
    }

    if (riskAssessment) {
      const lb = this.riskEngine.getSafetyLabel(riskAssessment.safetyScore);
      const el = document.getElementById('safetyScore'); if(el){el.textContent=lb.label; el.style.color=lb.color;}
      const gb = document.getElementById('safetyGauge'); if(gb) gb.style.width=riskAssessment.safetyScore+'%';
      const wr = document.getElementById('riskWarnings');
      if (wr) wr.textContent = riskAssessment.risks[0]?.message || '';
    }

    const fpsEl = document.getElementById('fpsCounter'); if(fpsEl) fpsEl.textContent = this.poseEngine.fps+' FPS';
    const cDot  = document.getElementById('cameraStatusDot');
    const cTxt  = document.getElementById('cameraStatusText');
    if (cDot && cTxt) {
      const live = this.state.isRunning && !this.state.isPaused;
      cDot.classList.toggle('active', live);
      cTxt.textContent = this.state.isPaused ? 'PAUSED' : live ? 'LIVE' : 'STANDBY';
    }
  }

  /* ── 세트 완료 ── */
  completeCurrentSet() {
    const data = this.exerciseRecognition.completeSet(this.state.weightInput);
    if (data) this._onSetComplete(data);
  }

  resetReps() {
    this.exerciseRecognition._resetRepState();
    const el = document.getElementById('repCounter'); if(el) el.textContent='0';
  }

  /* ── 토글류 ── */
  toggleVoice() {
    this.state.voiceEnabled = !this.state.voiceEnabled;
    const btn = document.getElementById('btnVoice');
    if (btn) { btn.textContent = this.state.voiceEnabled ? '🔊' : '🔇'; btn.classList.toggle('active', this.state.voiceEnabled); }
  }
  toggleSkeleton() {
    this.state.showSkeleton = !this.state.showSkeleton;
    document.getElementById('btnSkeleton')?.classList.toggle('active', this.state.showSkeleton);
    if (!this.state.showSkeleton) this._clearCanvas();
  }

  /* ── 유틸 ── */
  _resizeCanvas() {
    if (!this.canvas) return;
    const p = this.canvas.parentElement;
    if (p) { this.canvas.width = p.offsetWidth; this.canvas.height = p.offsetHeight; }
  }
  _clearCanvas() { if(this.ctx&&this.canvas) this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height); }
  _updateStatus(msg) { const el=document.getElementById('statusMessage'); if(el) el.textContent=msg; }
  _showError(msg) {
    console.error('[App]',msg);
    const el=document.getElementById('errorMessage');
    if(el){el.textContent=msg; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),5000);}
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.app = new App();
  await window.app.initialize();
});
