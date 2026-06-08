/**
 * app.js
 * 메인 애플리케이션 오케스트레이터
 * 모든 엔진을 통합하고 UI 상태를 관리
 * 
 * 담당: Senior Full Stack Developer + AI Engineer
 */

class App {
  constructor() {
    this.poseEngine = null;
    this.exerciseRecognition = null;
    this.biomechanicsEngine = null;
    this.riskEngine = null;
    this.dashboard = null;
    this.exerciseDB = null;

    // UI 상태
    this.state = {
      isRunning: false,
      isPaused: false,
      isSessionEnded: false,
      selectedExerciseId: '',
      isCalibrating: false,
      currentView: 'workout',   // 'workout' | 'dashboard' | 'settings'
      cameraMode: 'user',        // 'user' | 'environment'
      weightInput: 0,
      showSkeleton: true,
      showAngles: false,
      voiceEnabled: true,
      repGoal: 0,
      setGoal: 0
    };

    // 음성 피드백
    this.speechSynthesis = window.speechSynthesis;
    this.lastVoiceFeedback = 0;
    this.VOICE_COOLDOWN = 4000; // 4초
    this.voiceQueue = [];
    this.isSpeaking = false;

    // 운동 관련
    this.currentFormScore = 0;
    this.repCount = 0;
    this.setCount = 0;
    this.sessionTimer = null;
    this.sessionStartTime = null;
    this.sessionElapsedMs = 0;

    // 캔버스
    this.canvas = null;
    this.ctx = null;
    this.videoElement = null;

    // 최근 피드백 메시지
    this.recentFeedback = [];
    this.feedbackDisplayTime = 3000;
  }

  /**
   * 앱 초기화
   */
  async initialize() {
    console.log('[App] 초기화 시작');

    // 운동 데이터베이스 로드
    try {
      const response = await fetch('./exercise_database.json');
      this.exerciseDB = await response.json();
    } catch (e) {
      console.error('[App] 운동 DB 로드 실패, 기본값 사용');
      this.exerciseDB = { exercises: {}, muscleGroups: {} };
    }

    // 엔진 초기화
    this.poseEngine = window.poseEngine;
    this.exerciseRecognition = new ExerciseRecognition(this.exerciseDB);
    this.biomechanicsEngine = new BiomechanicsEngine(this.exerciseDB);
    this.riskEngine = new RiskEngine(this.exerciseDB);
    this.dashboard = new Dashboard();

    // DOM 요소 참조
    this.videoElement = document.getElementById('videoElement');
    this.canvas = document.getElementById('poseCanvas');
    this.ctx = this.canvas?.getContext('2d');

    // 엔진 콜백 설정
    this._setupCallbacks();

    // 이벤트 리스너 등록
    this._setupEventListeners();

    // 대시보드 DB 초기화
    await this.dashboard.initialize();

    this._populateExerciseSelect();

    // MediaPipe 초기화
    const poseReady = await this.poseEngine.initialize();
    if (!poseReady) {
      this._showError('MediaPipe 초기화 실패. 인터넷 연결을 확인해주세요.');
      return;
    }

    // 캔버스 리사이즈
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    // UI 업데이트 루프 시작
    this._startUILoop();

    this._updateStatus('카메라를 시작하려면 "시작" 버튼을 누르세요');
    console.log('[App] 초기화 완료');
  }

  /**
   * 콜백 설정
   */
  _setupCallbacks() {
    // 포즈 감지 콜백
    this.poseEngine.onPoseDetected = (poseData) => {
      this._onPoseDetected(poseData);
    };

    this.poseEngine.onError = (error) => {
      this._showError('카메라 오류: ' + error.message);
    };

    // 운동 감지 콜백
    this.exerciseRecognition.onExerciseDetected = (data) => {
      this._onExerciseDetected(data);
    };

    this.exerciseRecognition.onRepCounted = (data) => {
      this._onRepCounted(data);
    };

    this.exerciseRecognition.onSetComplete = (data) => {
      this._onSetComplete(data);
    };

    // 생체역학 콜백
    this.biomechanicsEngine.onFatigueAlert = (data) => {
      this._onFatigueDetected(data);
    };

    // 위험 감지 콜백
    this.riskEngine.onRiskDetected = (data) => {
      this._onRiskDetected(data);
    };
  }

  /**
   * 이벤트 리스너 설정
   */
  _setupEventListeners() {
    // 시작/정지 버튼
    document.getElementById('btnStart')?.addEventListener('click', () => this.startWorkout());
    document.getElementById('btnStop')?.addEventListener('click', () => this.pauseWorkout());

    // 카메라 전환
    document.getElementById('btnCameraFlip')?.addEventListener('click', () => this.flipCamera());
    document.getElementById('exerciseSelect')?.addEventListener('change', (e) => this.selectExercise(e.target.value));
    document.getElementById('btnAngles')?.addEventListener('click', () => this.toggleAngles());

    // 세트 완료
    document.getElementById('btnCompleteSet')?.addEventListener('click', () => this.completeCurrentSet());
    document.getElementById('btnResetReps')?.addEventListener('click', () => this.resetReps());

    // 음성 토글
    document.getElementById('btnVoice')?.addEventListener('click', () => this.toggleVoice());

    // 스켈레톤 토글
    document.getElementById('btnSkeleton')?.addEventListener('click', () => this.toggleSkeleton());

    // 대시보드 전환
    document.getElementById('btnDashboard')?.addEventListener('click', () => this.showDashboard());
    document.getElementById('btnWorkout')?.addEventListener('click', () => this.showWorkout());

    // 세션 종료
    document.getElementById('btnEndSession')?.addEventListener('click', () => this.endSession());

    // 무게 입력
    document.getElementById('weightInput')?.addEventListener('change', (e) => {
      this.state.weightInput = parseFloat(e.target.value) || 0;
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.completeCurrentSet(); }
      if (e.code === 'KeyR') this.resetReps();
      if (e.code === 'KeyV') this.toggleVoice();
    });
  }

  /**
   * 운동 선택 메뉴 구성
   */
  _populateExerciseSelect() {
    const select = document.getElementById('exerciseSelect');
    if (!select || !this.exerciseDB?.exercises) return;

    const categoryNames = {
      bodyweight: '맨몸 운동', dumbbell: '덤벨 운동', barbell: '바벨 운동',
      machine: '머신 운동', cable: '케이블 운동', core: '코어 운동',
      cardio: '유산소 운동', stretching: '스트레칭 운동', freeweight: '프리웨이트'
    };
    select.innerHTML = '<option value="">운동을 선택하세요</option>';
    const groups = {};
    Object.values(this.exerciseDB.exercises).forEach(ex => {
      const category = ex.category || 'etc';
      if (!groups[category]) groups[category] = [];
      groups[category].push(ex);
    });
    Object.entries(groups).forEach(([category, exercises]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = categoryNames[category] || category;
      exercises.sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(ex => {
        const opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.name;
        optgroup.appendChild(opt);
      });
      select.appendChild(optgroup);
    });
  }

  /**
   * 선택한 운동 정보 표시 및 수동 운동 모드 설정
   */
  selectExercise(exerciseId) {
    this.state.selectedExerciseId = exerciseId;
    const exercise = this.exerciseDB?.exercises?.[exerciseId];
    const panel = document.getElementById('exerciseInfoPanel');
    if (!panel) return;

    if (!exercise) {
      panel.innerHTML = '<div class="empty-guide">운동을 선택하면 목적, 자극 부위, 방법, 주의사항이 표시됩니다.</div>';
      return;
    }

    if (this.exerciseRecognition) this.exerciseRecognition.selectExercise(exerciseId);
    const muscles = (exercise.muscleGroups || []).map(m => this.exerciseDB.muscleGroups?.[m]?.name || m).join(', ');
    panel.innerHTML = `
      <div class="exercise-info-title">${exercise.name}</div>
      <div class="exercise-chip-row"><span>${this._categoryName(exercise.category)}</span><span>${muscles || '전신'}</span></div>
      <div class="info-section"><b>운동 목적</b><p>${exercise.purpose || '근력과 움직임 품질 향상'}</p></div>
      <div class="info-section"><b>주요 자극 부위</b><p>${muscles || '전신'}</p></div>
      <div class="info-section"><b>기대 효과</b><p>${exercise.benefits || '근력, 안정성, 자세 제어 능력 향상'}</p></div>
      <div class="info-section"><b>올바른 방법</b><ol>${(exercise.instructions || []).map(x => `<li>${x}</li>`).join('')}</ol></div>
      <div class="info-section warning"><b>주의사항</b><ul>${(exercise.precautions || []).map(x => `<li>${x}</li>`).join('')}</ul></div>`;

    const detected = document.getElementById('detectedExercise');
    if (detected) detected.textContent = exercise.name;
    this._updateStatus(`${exercise.name} 선택됨 - 시작 버튼을 누르세요`);
  }

  _categoryName(category) {
    return ({ bodyweight: '맨몸', dumbbell: '덤벨', barbell: '바벨', machine: '머신', cable: '케이블', core: '코어', cardio: '유산소', stretching: '스트레칭', freeweight: '프리웨이트' })[category] || category || '기타';
  }

  toggleAngles() {
    this.state.showAngles = !this.state.showAngles;
    document.getElementById('btnAngles')?.classList.toggle('active', this.state.showAngles);
  }

  _resetWorkoutUI() {
    const repEl = document.getElementById('repCounter'); if (repEl) repEl.textContent = '0';
    const setEl = document.getElementById('setCounter'); if (setEl) setEl.textContent = '0';
    const qualityEl = document.getElementById('repQuality'); if (qualityEl) qualityEl.textContent = '--';
    const timerEl = document.getElementById('sessionTimer'); if (timerEl) timerEl.textContent = '00:00';
    const startBtn = document.getElementById('btnStart'); if (startBtn) startBtn.textContent = '▶ 운동 시작';
  }

  /**
   * 운동 시작
   */
  async startWorkout() {
    if (this.state.isRunning) return;

    const selected = this.state.selectedExerciseId || document.getElementById('exerciseSelect')?.value;
    if (!selected) {
      this._showError('먼저 운동을 선택해주세요.');
      return;
    }

    const started = await this.poseEngine.startCamera(this.videoElement, this.state.cameraMode);
    if (!started) {
      this._showError('카메라 접근 권한이 필요합니다.');
      return;
    }

    const isResume = this.state.isPaused && this.sessionStartTime;
    this.state.isRunning = true;
    this.state.isPaused = false;
    this.state.isSessionEnded = false;

    if (!isResume) {
      this.sessionElapsedMs = 0;
      this.sessionStartTime = Date.now();
      this.dashboard.startSession();
      this.exerciseRecognition.resetSession();
      this.exerciseRecognition.selectExercise(selected);
      this.repCount = 0;
      this.setCount = 0;
      this._resetWorkoutUI();
    } else {
      this.sessionStartTime = Date.now() - this.sessionElapsedMs;
      this.exerciseRecognition.selectExercise(selected);
    }

    clearInterval(this.sessionTimer);
    this.sessionTimer = setInterval(() => this._updateSessionTimer(), 1000);
    this._updateSessionTimer();

    document.getElementById('btnStart')?.classList.add('hidden');
    document.getElementById('btnStop')?.classList.remove('hidden');
    document.getElementById('workoutControls')?.classList.remove('hidden');
    document.getElementById('exerciseSelect')?.setAttribute('disabled', 'disabled');

    this._updateStatus(isResume ? '운동을 재개했습니다' : '선택한 운동 분석 중...');
    this._speakFeedback(isResume ? '운동을 재개합니다.' : `${this.exerciseDB.exercises[selected].name} 운동을 시작합니다.`);
  }

  /**
   * 운동 일시정지: 카운트/타이머를 멈추고 현재 세션 데이터는 유지
   */
  async pauseWorkout() {
    if (!this.state.isRunning) return;

    this.state.isRunning = false;
    this.state.isPaused = true;
    this.sessionElapsedMs = this.sessionStartTime ? Date.now() - this.sessionStartTime : this.sessionElapsedMs;
    clearInterval(this.sessionTimer);
    this.sessionTimer = null;

    await this.poseEngine.stopCamera();

    document.getElementById('btnStart')?.classList.remove('hidden');
    document.getElementById('btnStop')?.classList.add('hidden');
    const startBtn = document.getElementById('btnStart');
    if (startBtn) startBtn.textContent = '▶ 운동 재개';

    this._updateStatus('일시정지됨 - 재개 버튼을 누르면 이어서 진행됩니다');
    this._clearCanvas();
  }

  /**
   * 기존 stopWorkout 호환용: 일시정지로 동작
   */
  async stopWorkout() {
    return this.pauseWorkout();
  }

  /**
   * 카메라 전환
   */
  async flipCamera() {
    this.state.cameraMode = this.state.cameraMode === 'user' ? 'environment' : 'user';
    if (this.state.isRunning) {
      await this.poseEngine.startCamera(this.videoElement, this.state.cameraMode);
    }
  }

  /**
   * 포즈 감지 메인 처리
   */
  _onPoseDetected(poseData) {
    if (!this.state.isRunning) return;

    const { landmarks, angles, metrics } = poseData;

    // 운동 감지
    const detection = this.exerciseRecognition.detectExercise(poseData);

    // 반복 감지
    if (this.exerciseRecognition.currentExercise) {
      this.exerciseRecognition.detectRep(angles);
    }

    // 자세 분석
    let formScore = null;
    let riskAssessment = null;

    if (this.exerciseRecognition.currentExercise) {
      formScore = this.biomechanicsEngine.calculateFormScore(
        poseData,
        this.exerciseRecognition.currentExercise
      );

      riskAssessment = this.riskEngine.assessRisk(
        poseData,
        this.exerciseRecognition.currentExercise
      );

      // 자세 점수 업데이트
      this.currentFormScore = formScore.total;

      // 피드백 생성 (쿨다운 적용)
      this._processFeedback(formScore, riskAssessment);
    }

    // 캔버스에 그리기
    if (this.canvas && this.ctx && this.state.showSkeleton) {
      this._drawFrame(landmarks, angles, formScore, riskAssessment);
    }

    // UI 업데이트
    this._updateRealTimeUI(formScore, riskAssessment, detection);
  }

  /**
   * 캔버스에 프레임 그리기
   */
  _drawFrame(landmarks, angles, formScore, riskAssessment) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 캔버스 클리어
    ctx.clearRect(0, 0, w, h);

    // 포즈 스켈레톤 그리기
    if (landmarks) {
      const score = formScore ? formScore.total : null;
      this.poseEngine.drawPose(ctx, landmarks, score);

      // 각도 표시 (옵션)
      if (this.state.showAngles && angles) {
        this._drawAngles(ctx, landmarks, angles);
      }

      // 위험 하이라이트
      if (riskAssessment && riskAssessment.risks.length > 0) {
        this._drawRiskHighlights(ctx, landmarks, riskAssessment.risksByJoint);
      }
    }

    // 반복 카운터 오버레이
    this._drawRepCounter(ctx, w, h);
  }

  /**
   * 관절 각도 텍스트 표시
   */
  _drawAngles(ctx, landmarks, angles) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const L = this.poseEngine.LANDMARKS;

    const displayAngles = [
      { joint: L.RIGHT_ELBOW, angle: angles.rightElbow, label: 'R팔꿈치' },
      { joint: L.LEFT_ELBOW, angle: angles.leftElbow, label: 'L팔꿈치' },
      { joint: L.RIGHT_KNEE, angle: angles.rightKnee, label: 'R무릎' },
      { joint: L.LEFT_KNEE, angle: angles.leftKnee, label: 'L무릎' },
      { joint: L.RIGHT_HIP, angle: angles.rightHip, label: 'R고관절' },
      { joint: L.LEFT_HIP, angle: angles.leftHip, label: 'L고관절' }
    ];

    ctx.font = 'bold 13px monospace';

    displayAngles.forEach(({ joint, angle, label }) => {
      if (angle === null || angle === undefined) return;
      const lm = landmarks[joint];
      if (!lm || lm.visibility < 0.5) return;

      const x = lm.x * w + 10;
      const y = lm.y * h - 5;

      // 배경
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 2, y - 14, 70, 18);

      // 텍스트
      ctx.fillStyle = angle > 90 ? '#00ffaa' : '#ffaa00';
      ctx.fillText(`${angle}°`, x, y);
    });
  }

  /**
   * 위험 부위 하이라이트
   */
  _drawRiskHighlights(ctx, landmarks, risksByJoint) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const L = this.poseEngine.LANDMARKS;

    const jointLandmarks = {
      spine: [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP],
      knee: [L.LEFT_KNEE, L.RIGHT_KNEE],
      shoulder: [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
      hip: [L.LEFT_HIP, L.RIGHT_HIP],
      ankle: [L.LEFT_ANKLE, L.RIGHT_ANKLE]
    };

    for (const [joint, risks] of Object.entries(risksByJoint)) {
      const indices = jointLandmarks[joint];
      if (!indices) continue;

      const maxSeverity = risks.reduce((max, r) => {
        const order = { critical: 4, high: 3, medium: 2, low: 1 };
        return order[r.severity] > order[max] ? r.severity : max;
      }, 'low');

      const color = this.riskEngine.getRiskColor(
        maxSeverity === 'critical' ? 90 :
        maxSeverity === 'high' ? 65 :
        maxSeverity === 'medium' ? 35 : 15
      );

      indices.forEach(idx => {
        const lm = landmarks[idx];
        if (!lm || lm.visibility < 0.5) return;

        const x = lm.x * w;
        const y = lm.y * h;

        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.stroke();
        ctx.shadowBlur = 0;
      });
    }
  }

  /**
   * 반복 카운터 오버레이
   */
  _drawRepCounter(ctx, w, h) {
    const reps = this.exerciseRecognition.repCount;
    const exercise = this.exerciseRecognition.currentExercise;

    if (!exercise) return;

    // 반투명 배경
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(w - 110, 10, 100, 60);

    // 반복 횟수
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(reps, w - 15, 60);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '12px monospace';
    ctx.fillText('REPS', w - 15, 75);

    ctx.textAlign = 'left';
  }

  /**
   * 피드백 처리 (음성 + 화면)
   */
  _processFeedback(formScore, riskAssessment) {
    const now = Date.now();

    // 치명적 위험은 즉시 알림
    if (riskAssessment) {
      const criticalRisk = riskAssessment.risks.find(r => r.severity === 'critical');
      if (criticalRisk && now - this.lastVoiceFeedback > 2000) {
        this._speakFeedback(criticalRisk.message, true);
        this._showFeedbackMessage(criticalRisk.message, 'critical');
        this.lastVoiceFeedback = now;
        return;
      }
    }

    // 일반 자세 피드백 (4초 간격)
    if (now - this.lastVoiceFeedback > this.VOICE_COOLDOWN) {
      if (formScore && formScore.feedback.length > 0) {
        const topFeedback = formScore.feedback[0];
        this._speakFeedback(topFeedback.message);
        this._showFeedbackMessage(topFeedback.message, topFeedback.type);
        this.lastVoiceFeedback = now;
      } else if (formScore && formScore.total >= 85) {
        // 자세가 좋을 때 칭찬
        this._speakFeedback('현재 자세가 매우 안정적입니다! 계속하세요.');
        this.lastVoiceFeedback = now;
      }
    }

    // 화면 피드백 업데이트
    if (formScore && formScore.feedback.length > 0) {
      formScore.feedback.slice(0, 2).forEach(fb => {
        this._showFeedbackMessage(fb.message, fb.type);
      });
    }
  }

  /**
   * 음성 피드백
   */
  _speakFeedback(text, priority = false) {
    if (!this.state.voiceEnabled || !this.speechSynthesis) return;

    if (priority) {
      this.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 0.9;

    this.speechSynthesis.speak(utterance);
  }

  /**
   * 화면 피드백 메시지 표시
   */
  _showFeedbackMessage(message, type = 'info') {
    const container = document.getElementById('feedbackContainer');
    if (!container) return;

    // 중복 메시지 방지
    const existing = [...container.querySelectorAll('.feedback-msg')]
      .find(el => el.textContent.includes(message.slice(0, 20)));
    if (existing) return;

    const el = document.createElement('div');
    el.className = `feedback-msg feedback-${type}`;
    el.textContent = message;
    container.appendChild(el);

    // 3초 후 제거
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 500);
    }, this.feedbackDisplayTime);

    // 최대 3개 유지
    const msgs = container.querySelectorAll('.feedback-msg');
    if (msgs.length > 3) msgs[0].remove();
  }

  /**
   * 운동 감지 콜백
   */
  _onExerciseDetected(data) {
    const exerciseEl = document.getElementById('detectedExercise');
    if (exerciseEl && data.exercise) {
      exerciseEl.textContent = data.exercise.name;
      exerciseEl.style.color = '#00ffff';
    }

    if (data.previousExercise !== data.exercise) {
      this._speakFeedback(`${data.exercise.name} 운동이 감지되었습니다.`);
    }

    // 운동 인식 신뢰도
    const confEl = document.getElementById('exerciseConfidence');
    if (confEl) {
      confEl.textContent = `${Math.round(data.confidence * 100)}%`;
    }
  }

  /**
   * 반복 카운트 콜백
   */
  _onRepCounted(data) {
    this.repCount = data.count;

    const repEl = document.getElementById('repCounter');
    if (repEl) {
      repEl.textContent = data.count;
      repEl.classList.add('pulse');
      setTimeout(() => repEl.classList.remove('pulse'), 300);
    }

    // 반복 품질 표시
    if (data.quality !== null) {
      const qualityEl = document.getElementById('repQuality');
      if (qualityEl) {
        qualityEl.textContent = data.quality + '점';
        qualityEl.style.color = data.quality >= 80 ? '#00ff88' : data.quality >= 60 ? '#ffd700' : '#ff4444';
      }
    }

    // 목표 달성 체크
    if (this.state.repGoal > 0 && data.count >= this.state.repGoal) {
      this._speakFeedback(`목표 ${this.state.repGoal}회 달성! 잘 하셨습니다!`);
    }
  }

  /**
   * 세트 완료 콜백
   */
  _onSetComplete(setData) {
    this.setCount++;
    this.dashboard.addSet(setData);

    const setEl = document.getElementById('setCounter');
    if (setEl) setEl.textContent = this.setCount + '세트';

    this._showFeedbackMessage(`${setData.reps}회 완료! 자세 점수: ${setData.averageQuality}점`, 'success');
    this._speakFeedback(`세트 완료! ${setData.reps}회 수행했습니다. 잠시 휴식하세요.`);
  }

  /**
   * 피로도 감지 콜백
   */
  _onFatigueDetected(data) {
    const fatigueEl = document.getElementById('fatigueIndicator');
    if (fatigueEl) {
      fatigueEl.textContent = data.level === 'high' ? '피로도 높음 ⚠️' : '피로도 감지';
      fatigueEl.style.color = data.level === 'high' ? '#ff4444' : '#ffa500';
    }

    if (data.level === 'high') {
      this._speakFeedback('피로도가 높습니다. 잠시 휴식을 취하세요.');
    }
  }

  /**
   * 위험 감지 콜백
   */
  _onRiskDetected(data) {
    const riskEl = document.getElementById('riskLevel');
    if (riskEl) {
      const label = this.riskEngine.getSafetyLabel(100 - data.risk.score);
      riskEl.textContent = label.label;
      riskEl.style.color = label.color;
    }

    this._speakFeedback(data.risk.message, true);
    this._showFeedbackMessage(data.risk.message, 'error');
  }

  /**
   * 실시간 UI 업데이트
   */
  _updateRealTimeUI(formScore, riskAssessment, detection) {
    // 자세 점수 업데이트
    if (formScore) {
      const scoreEl = document.getElementById('formScore');
      if (scoreEl) {
        scoreEl.textContent = formScore.total;
        scoreEl.style.color = formScore.total >= 80 ? '#00ff88' : formScore.total >= 60 ? '#ffd700' : '#ff4444';
      }

      // 점수 게이지
      const gaugeEl = document.getElementById('scoreGauge');
      if (gaugeEl) {
        gaugeEl.style.width = formScore.total + '%';
        gaugeEl.style.background = formScore.total >= 80 ? '#00ff88' : formScore.total >= 60 ? '#ffd700' : '#ff4444';
      }

      // 등급
      const gradeEl = document.getElementById('formGrade');
      if (gradeEl && formScore.grade) {
        gradeEl.textContent = formScore.grade.grade;
        gradeEl.style.color = formScore.grade.color;
      }

      // 세부 점수 바 업데이트
      const components = formScore.components;
      Object.entries(components).forEach(([key, value]) => {
        const barEl = document.getElementById(`score-${key}`);
        if (barEl) {
          barEl.style.width = value + '%';
        }
      });
    }

    // 안전 점수 업데이트
    if (riskAssessment) {
      const safetyEl = document.getElementById('safetyScore');
      if (safetyEl) {
        const label = this.riskEngine.getSafetyLabel(riskAssessment.safetyScore);
        safetyEl.textContent = label.label;
        safetyEl.style.color = label.color;
      }

      const safetyBarEl = document.getElementById('safetyGauge');
      if (safetyBarEl) {
        safetyBarEl.style.width = riskAssessment.safetyScore + '%';
      }
    }

    // FPS 표시
    const fpsEl = document.getElementById('fpsCounter');
    if (fpsEl) fpsEl.textContent = this.poseEngine.fps + ' FPS';

    // 포즈 신뢰도
    const confEl = document.getElementById('poseConfidence');
    if (confEl && detection) {
      confEl.textContent = Math.round(detection.confidence * 100) + '%';
    }
  }

  /**
   * 현재 세트 완료
   */
  completeCurrentSet() {
    const setData = this.exerciseRecognition.completeSet(this.state.weightInput);
    if (!setData) {
      this._showFeedbackMessage('완료할 반복 횟수가 없습니다.', 'warning');
    }
  }

  /**
   * 반복 횟수 리셋
   */
  resetReps() {
    this.exerciseRecognition._resetRepState();
    const repEl = document.getElementById('repCounter');
    if (repEl) repEl.textContent = '0';
    const qualityEl = document.getElementById('repQuality');
    if (qualityEl) qualityEl.textContent = '--';
  }

  /**
   * 세션 종료
   */
  async endSession() {
    if (this.state.isRunning) {
      this.sessionElapsedMs = this.sessionStartTime ? Date.now() - this.sessionStartTime : this.sessionElapsedMs;
    }

    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.isSessionEnded = true;
    clearInterval(this.sessionTimer);
    this.sessionTimer = null;

    if (this.poseEngine) await this.poseEngine.stopCamera();
    this._clearCanvas();
    if (this.speechSynthesis) this.speechSynthesis.cancel();

    const sessionData = await this.dashboard.endSession();

    document.getElementById('btnStart')?.classList.remove('hidden');
    document.getElementById('btnStop')?.classList.add('hidden');
    document.getElementById('workoutControls')?.classList.add('hidden');
    document.getElementById('exerciseSelect')?.removeAttribute('disabled');
    const startBtn = document.getElementById('btnStart');
    if (startBtn) startBtn.textContent = '▶ 운동 시작';

    this.exerciseRecognition.resetSession();
    this.sessionStartTime = null;
    this.sessionElapsedMs = 0;
    this._updateStatus('세션이 완전히 종료되었습니다');

    if (sessionData) {
      const totalSets = sessionData.sets?.length || 0;
      const totalReps = sessionData.totalReps || 0;
      this._speakFeedback(`운동 완료! 총 ${totalSets}세트, ${totalReps}회 운동했습니다.`);
    }

    this.showDashboard();
  }

  /**
   * 대시보드 표시
   */
  async showDashboard() {
    this.state.currentView = 'dashboard';
    document.getElementById('workoutView')?.classList.add('hidden');
    document.getElementById('dashboardView')?.classList.remove('hidden');
    await this.dashboard.renderDashboard('dashboardContainer');
  }

  /**
   * 운동 화면 표시
   */
  showWorkout() {
    this.state.currentView = 'workout';
    document.getElementById('workoutView')?.classList.remove('hidden');
    document.getElementById('dashboardView')?.classList.add('hidden');
  }

  /**
   * 음성 토글
   */
  toggleVoice() {
    this.state.voiceEnabled = !this.state.voiceEnabled;
    const btn = document.getElementById('btnVoice');
    if (btn) {
      btn.textContent = this.state.voiceEnabled ? '🔊' : '🔇';
      btn.title = this.state.voiceEnabled ? '음성 피드백 켜짐' : '음성 피드백 꺼짐';
    }
  }

  /**
   * 스켈레톤 토글
   */
  toggleSkeleton() {
    this.state.showSkeleton = !this.state.showSkeleton;
    const btn = document.getElementById('btnSkeleton');
    if (btn) {
      btn.classList.toggle('active', this.state.showSkeleton);
    }
  }

  /**
   * 세션 타이머 업데이트
   */
  _updateSessionTimer() {
    if (!this.sessionStartTime) return;
    const elapsed = this.state.isRunning ? Date.now() - this.sessionStartTime : this.sessionElapsedMs;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timerEl = document.getElementById('sessionTimer');
    if (timerEl) {
      timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }

  /**
   * UI 루프 시작
   */
  _startUILoop() {
    setInterval(() => {
      if (!this.state.isRunning) return;
      const pose = this.poseEngine.getCurrentPose();
      // 추가 UI 업데이트
    }, 100);
  }

  /**
   * 캔버스 리사이즈
   */
  _resizeCanvas() {
    if (!this.canvas || !this.videoElement) return;

    const container = this.canvas.parentElement;
    if (container) {
      this.canvas.width = container.offsetWidth;
      this.canvas.height = container.offsetHeight;
    }
  }

  /**
   * 캔버스 클리어
   */
  _clearCanvas() {
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * 상태 메시지 업데이트
   */
  _updateStatus(message) {
    const statusEl = document.getElementById('statusMessage');
    if (statusEl) statusEl.textContent = message;
  }

  /**
   * 에러 표시
   */
  _showError(message) {
    console.error('[App] Error:', message);
    this._updateStatus('오류: ' + message);

    const errorEl = document.getElementById('errorMessage');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
      setTimeout(() => errorEl.classList.add('hidden'), 5000);
    }
  }
}

// 앱 초기화
document.addEventListener('DOMContentLoaded', async () => {
  window.app = new App();
  await window.app.initialize();
});
