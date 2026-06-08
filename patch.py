import json, re
from pathlib import Path
p=Path('/mnt/data/prog')
# patch exerciseRecognition
ex=p/'exerciseRecognition.js'
s=ex.read_text()
s=s.replace("    this.currentExercise = null;\n    this.detectionConfidence = 0;", "    this.currentExercise = null;\n    this.selectedExercise = null;\n    this.manualMode = false;\n    this.detectionConfidence = 0;")
# insert methods before detectExercise
s=s.replace("  /**\n   * 포즈 데이터를 분석하여 운동 종목 감지", "  /**\n   * 사용자가 직접 운동을 선택했을 때 자동 인식을 잠그고 해당 운동으로 진행\n   */\n  selectExercise(exerciseId) {\n    if (!exerciseId || !this.exerciseDB.exercises[exerciseId]) {\n      this.manualMode = false;\n      this.selectedExercise = null;\n      this.currentExercise = null;\n      this._resetRepState();\n      return null;\n    }\n\n    const previousExercise = this.currentExercise;\n    this.manualMode = true;\n    this.selectedExercise = exerciseId;\n    this.currentExercise = exerciseId;\n    this.detectionConfidence = 1;\n    this.detectionBuffer = [];\n    this._resetRepState(false);\n\n    if (this.onExerciseDetected) {\n      this.onExerciseDetected({\n        exercise: this.exerciseDB.exercises[exerciseId],\n        previousExercise: previousExercise ? this.exerciseDB.exercises[previousExercise] : null,\n        confidence: 1,\n        manual: true\n      });\n    }\n    return this.exerciseDB.exercises[exerciseId];\n  }\n\n  /**\n   * 자동 운동 인식 모드로 전환\n   */\n  enableAutoDetection() {\n    this.manualMode = false;\n    this.selectedExercise = null;\n    this.currentExercise = null;\n    this.detectionConfidence = 0;\n    this.detectionBuffer = [];\n    this._resetRepState(false);\n  }\n\n  /**\n   * 포즈 데이터를 분석하여 운동 종목 감지")
# manual detection early
s=s.replace("    const { angles, landmarks } = poseData;\n\n    if (!angles || !landmarks) return null;", "    const { angles, landmarks } = poseData;\n\n    if (!angles || !landmarks) return null;\n\n    if (this.manualMode && this.selectedExercise) {\n      return {\n        detected: this.selectedExercise,\n        confidence: 1,\n        allScores: { [this.selectedExercise]: 1 },\n        manual: true\n      };\n    }")
# replace process rep state function more general
start=s.index("  _processRepState(angle, repDef) {")
end=s.index("\n  /**\n   * 이소메트릭", start)
new_func=r'''  _processRepState(angle, repDef) {
    const sm = this.repStateMachine;
    const now = Date.now();
    const MIN_REP_INTERVAL = 500;
    const direction = repDef.direction || 'down_up';
    const highThreshold = Math.max(repDef.topThreshold ?? 160, repDef.bottomThreshold ?? 80);
    const lowThreshold = Math.min(repDef.topThreshold ?? 160, repDef.bottomThreshold ?? 80);
    const startsHigh = (repDef.topThreshold ?? highThreshold) >= (repDef.bottomThreshold ?? lowThreshold);
    let repCompleted = false;
    let repQuality = null;

    // 대부분 운동: 펴진 자세(큰 각도) → 굽힌 자세(작은 각도) → 다시 펴짐
    if (startsHigh) {
      switch (sm.state) {
        case 'idle':
          if (angle >= highThreshold) {
            sm.state = 'top'; sm.repStartAngle = angle; sm.repStartTime = now;
          }
          break;
        case 'top':
          if (angle <= lowThreshold + 20) sm.state = 'descending';
          break;
        case 'descending':
          if (angle <= lowThreshold) { sm.state = 'bottom'; sm.bottomAngle = angle; sm.bottomTime = now; }
          break;
        case 'bottom':
          if (angle >= lowThreshold + 15) sm.state = 'ascending';
          break;
        case 'ascending':
          if (angle >= highThreshold && (now - sm.lastRepTime) > MIN_REP_INTERVAL) {
            repCompleted = true;
          }
          break;
      }
    } else {
      // 풀업/로우처럼 시작이 팔이 펴진 큰 각도이고, 정상 완료 지점이 작은 각도인 운동
      // bottomThreshold를 시작 위치, topThreshold를 수축 위치로 해석한다.
      switch (sm.state) {
        case 'idle':
          if (angle >= highThreshold) {
            sm.state = 'bottom'; sm.repStartAngle = angle; sm.repStartTime = now;
          }
          break;
        case 'bottom':
          if (angle <= highThreshold - 15) sm.state = 'ascending';
          break;
        case 'ascending':
          if (angle <= lowThreshold) { sm.state = 'top'; sm.bottomAngle = angle; sm.bottomTime = now; }
          break;
        case 'top':
          if (angle >= lowThreshold + 20) sm.state = 'descending';
          break;
        case 'descending':
          if (angle >= highThreshold && (now - sm.lastRepTime) > MIN_REP_INTERVAL) {
            repCompleted = true;
          }
          break;
      }
    }

    if (repCompleted) {
      this.repCount++;
      repQuality = this._calculateRepQuality(sm, angle, now);
      this.repHistory.push({
        repNumber: this.repCount,
        quality: repQuality,
        duration: now - (sm.repStartTime || now),
        bottomAngle: sm.bottomAngle,
        timestamp: now
      });
      sm.lastRepTime = now;
      sm.state = startsHigh ? 'top' : 'bottom';
      sm.repStartAngle = angle;
      sm.repStartTime = now;
      if (this.onRepCounted) {
        this.onRepCounted({ count: this.repCount, quality: repQuality, exercise: this.currentExercise });
      }
    }

    return { repCompleted, repCount: this.repCount, state: sm.state, repQuality, currentAngle: angle };
  }
'''
s=s[:start]+new_func+s[end:]
s=s.replace("  _resetRepState() {", "  _resetRepState(resetCount = true) {")
s=s.replace("    this.repCount = 0;\n    this.repHistory = [];", "    if (resetCount) this.repCount = 0;\n    if (resetCount) this.repHistory = [];")
s=s.replace("    this.currentExercise = null;\n    this.detectionBuffer = [];", "    if (!this.manualMode) this.currentExercise = null;\n    this.detectionBuffer = [];")
ex.write_text(s)

# patch app.js
ap=p/'app.js'
s=ap.read_text()
s=s.replace("      isRunning: false,\n      isCalibrating: false,", "      isRunning: false,\n      isPaused: false,\n      isSessionEnded: false,\n      selectedExerciseId: '',\n      isCalibrating: false,")
s=s.replace("    this.sessionTimer = null;\n    this.sessionStartTime = null;", "    this.sessionTimer = null;\n    this.sessionStartTime = null;\n    this.sessionElapsedMs = 0;")
# add event listeners
s=s.replace("    document.getElementById('btnStop')?.addEventListener('click', () => this.stopWorkout());", "    document.getElementById('btnStop')?.addEventListener('click', () => this.pauseWorkout());")
s=s.replace("    document.getElementById('btnCameraFlip')?.addEventListener('click', () => this.flipCamera());", "    document.getElementById('btnCameraFlip')?.addEventListener('click', () => this.flipCamera());\n    document.getElementById('exerciseSelect')?.addEventListener('change', (e) => this.selectExercise(e.target.value));\n    document.getElementById('btnAngles')?.addEventListener('click', () => this.toggleAngles());")
s=s.replace("    document.getElementById('btnCompleteSet')?.addEventListener('click', () => this.completeCurrentSet());", "    document.getElementById('btnCompleteSet')?.addEventListener('click', () => this.completeCurrentSet());\n    document.getElementById('btnResetReps')?.addEventListener('click', () => this.resetReps());")
# after dashboard init add populate
s=s.replace("    // 대시보드 DB 초기화\n    await this.dashboard.initialize();", "    // 대시보드 DB 초기화\n    await this.dashboard.initialize();\n\n    this._populateExerciseSelect();")
# replace startWorkout and stopWorkout
start=s.index("  async startWorkout() {")
end=s.index("\n  /**\n   * 카메라 전환", start)
new=r'''  async startWorkout() {
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
'''
s=s[:start]+new+s[end:]
# onPoseDetected detection: if selected manual okay. but no count if paused due isRunning false. ok
# completeCurrentSet duplicate
s=s.replace("  completeCurrentSet() {\n    const setData = this.exerciseRecognition.completeSet(this.state.weightInput);\n    if (setData) {\n      this._onSetComplete(setData);\n    }\n  }", "  completeCurrentSet() {\n    const setData = this.exerciseRecognition.completeSet(this.state.weightInput);\n    if (!setData) {\n      this._showFeedbackMessage('완료할 반복 횟수가 없습니다.', 'warning');\n    }\n  }")
# reset reps update quality
s=s.replace("    this.exerciseRecognition._resetRepState();", "    this.exerciseRecognition._resetRepState();")
s=s.replace("    if (repEl) repEl.textContent = '0';\n  }", "    if (repEl) repEl.textContent = '0';\n    const qualityEl = document.getElementById('repQuality');\n    if (qualityEl) qualityEl.textContent = '--';\n  }")
# replace endSession
start=s.index("  async endSession() {")
end=s.index("\n  /**\n   * 대시보드 표시", start)
new=r'''  async endSession() {
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
'''
s=s[:start]+new+s[end:]
# update timer elapsed
s=s.replace("    const elapsed = Date.now() - this.sessionStartTime;", "    const elapsed = this.state.isRunning ? Date.now() - this.sessionStartTime : this.sessionElapsedMs;")
# insert methods before startWorkout? after listeners before startWorkout
insert_after=s.index("  /**\n   * 운동 시작")
methods=r'''  /**
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

'''
s=s[:insert_after]+methods+s[insert_after:]
ap.write_text(s)

# patch html remove onclicks, add select panel and IDs
hp=p/'index.html'
h=hp.read_text()
h=re.sub(r' onclick="[^"]*"','',h)
h=h.replace('<button class="nav-btn active" id="btnWorkout">운동</button>', '<button class="nav-btn active" id="btnWorkout">운동</button>')
# add selector before session timer
needle='''        <div class="side-panel">\n\n          <!-- Session Timer -->'''
add='''        <div class="side-panel">\n\n          <!-- Exercise Select -->\n          <div class="panel-card exercise-select-card">\n            <div class="panel-card-title">운동 선택</div>\n            <select id="exerciseSelect" class="exercise-select">\n              <option value="">운동 데이터를 불러오는 중...</option>\n            </select>\n            <div id="exerciseInfoPanel" class="exercise-info-panel">\n              <div class="empty-guide">운동을 선택하면 목적, 자극 부위, 방법, 주의사항이 표시됩니다.</div>\n            </div>\n          </div>\n\n          <!-- Session Timer -->'''
h=h.replace(needle, add)
h=h.replace('<button class="btn btn-neutral" title="R키">', '<button class="btn btn-neutral" id="btnResetReps" title="R키">')
hp.write_text(h)

# append CSS
css=p/'style.css'
cs=css.read_text()
cs += r'''

/* ── Beginner-friendly exercise selector ── */
.exercise-select-card { border-color: rgba(0, 255, 136, 0.25); }
.exercise-select {
  width: 100%;
  background: var(--bg-deep);
  color: var(--text-bright);
  border: var(--border-active);
  border-radius: var(--radius);
  padding: 10px 12px;
  font-family: var(--font-body);
  font-size: 13px;
  outline: none;
}
.exercise-select:disabled { opacity: .65; cursor: not-allowed; }
.exercise-info-panel {
  margin-top: 10px;
  max-height: 280px;
  overflow: auto;
  padding-right: 4px;
  color: var(--text-mid);
  line-height: 1.55;
  font-size: 12px;
}
.exercise-info-title {
  color: var(--neon-green);
  font-family: var(--font-display);
  font-size: 15px;
  margin-bottom: 6px;
}
.exercise-chip-row { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.exercise-chip-row span {
  border: 1px solid rgba(0,245,255,.25);
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--neon-cyan);
  background: rgba(0,245,255,.06);
  font-size: 11px;
}
.info-section { margin: 8px 0; }
.info-section b { color: var(--text-bright); display:block; margin-bottom:2px; }
.info-section ol, .info-section ul { padding-left: 18px; }
.info-section.warning { color: #ffbf7a; }
.empty-guide { color: var(--text-dim); font-size: 12px; padding: 8px 0; }
.btn:disabled { opacity:.55; cursor:not-allowed; }
@media (max-width: 900px) {
  .workout-layout { grid-template-columns: 1fr; height: auto; }
  .camera-section { min-height: 420px; }
  .side-panel { max-height: none; }
}
'''
css.write_text(cs)
