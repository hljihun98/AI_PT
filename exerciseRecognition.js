/**
 * exerciseRecognition.js
 * 포즈 패턴 매칭 기반 운동 종목 자동 인식 및 반복 횟수 카운팅
 * 
 * 담당: Senior Computer Vision Engineer + Elite Personal Trainer
 */

class ExerciseRecognition {
  constructor(exerciseDB) {
    this.exerciseDB = exerciseDB;
    this.currentExercise = null;
    this.selectedExercise = null;
    this.manualMode = false;
    this.detectionConfidence = 0;
    this.repCount = 0;
    this.setCount = 0;
    this.repState = 'idle'; // idle, descending, bottom, ascending, top
    this.repHistory = [];   // 각 반복의 데이터
    this.isResting = false;
    this.restTimer = null;

    // 반복 감지용 상태 머신
    this.repStateMachine = {
      state: 'idle',
      primaryAngleHistory: [],
      historySize: 10,
      inRep: false,
      atBottom: false,
      lastRepTime: 0
    };

    // 운동 세션 데이터
    this.sessionData = {
      startTime: null,
      sets: [],
      currentSet: {
        exercise: null,
        reps: [],
        startTime: null
      }
    };

    // 콜백
    this.onExerciseDetected = null;
    this.onRepCounted = null;
    this.onSetComplete = null;

    // 연속 감지 버퍼
    this.detectionBuffer = [];
    this.bufferSize = 15; // 15프레임 연속 같은 운동이면 확정
    this.CONFIDENCE_THRESHOLD = 0.75;
  }

  /**
   * 사용자가 직접 운동을 선택했을 때 자동 인식을 잠그고 해당 운동으로 진행
   */
  selectExercise(exerciseId) {
    if (!exerciseId || !this.exerciseDB.exercises[exerciseId]) {
      this.manualMode = false;
      this.selectedExercise = null;
      this.currentExercise = null;
      this._resetRepState();
      return null;
    }

    const previousExercise = this.currentExercise;
    this.manualMode = true;
    this.selectedExercise = exerciseId;
    this.currentExercise = exerciseId;
    this.detectionConfidence = 1;
    this.detectionBuffer = [];
    this._resetRepState(false);

    if (this.onExerciseDetected) {
      this.onExerciseDetected({
        exercise: this.exerciseDB.exercises[exerciseId],
        previousExercise: previousExercise ? this.exerciseDB.exercises[previousExercise] : null,
        confidence: 1,
        manual: true
      });
    }
    return this.exerciseDB.exercises[exerciseId];
  }

  /**
   * 자동 운동 인식 모드로 전환
   */
  enableAutoDetection() {
    this.manualMode = false;
    this.selectedExercise = null;
    this.currentExercise = null;
    this.detectionConfidence = 0;
    this.detectionBuffer = [];
    this._resetRepState(false);
  }

  /**
   * 포즈 데이터를 분석하여 운동 종목 감지
   * @param {Object} poseData - PoseEngine에서 전달된 포즈 데이터
   * @returns {Object} 감지된 운동 및 신뢰도
   */
  detectExercise(poseData) {
    const { angles, landmarks } = poseData;

    if (!angles || !landmarks) return null;

    if (this.manualMode && this.selectedExercise) {
      return {
        detected: this.selectedExercise,
        confidence: 1,
        allScores: { [this.selectedExercise]: 1 },
        manual: true
      };
    }

    // 각 운동별 매칭 점수 계산
    const scores = {};

    for (const [exerciseId, exercise] of Object.entries(this.exerciseDB.exercises)) {
      scores[exerciseId] = this._matchExercise(exerciseId, angles, landmarks);
    }

    // 가장 높은 점수의 운동 선택
    let bestExercise = null;
    let bestScore = 0;

    for (const [exerciseId, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestExercise = exerciseId;
      }
    }

    // 감지 버퍼에 추가
    if (bestScore >= this.CONFIDENCE_THRESHOLD) {
      this.detectionBuffer.push(bestExercise);
    } else {
      this.detectionBuffer.push(null);
    }

    if (this.detectionBuffer.length > this.bufferSize) {
      this.detectionBuffer.shift();
    }

    // 버퍼에서 가장 많은 운동 확정
    const confirmedExercise = this._confirmExercise();
    this.detectionConfidence = bestScore;

    // 운동이 변경된 경우
    if (confirmedExercise !== this.currentExercise) {
      const prevExercise = this.currentExercise;
      this.currentExercise = confirmedExercise;

      if (confirmedExercise && this.onExerciseDetected) {
        this.onExerciseDetected({
          exercise: this.exerciseDB.exercises[confirmedExercise],
          previousExercise: prevExercise ? this.exerciseDB.exercises[prevExercise] : null,
          confidence: bestScore
        });
      }

      // 새 운동 시작 시 상태 초기화
      if (confirmedExercise !== prevExercise) {
        this._resetRepState();
      }
    }

    return {
      detected: confirmedExercise,
      confidence: bestScore,
      allScores: scores
    };
  }

  /**
   * 특정 운동과의 매칭 점수 계산 (0~1)
   */
  _matchExercise(exerciseId, angles, landmarks) {
    const exercise = this.exerciseDB.exercises[exerciseId];
    if (!exercise || !exercise.keyAngles) return 0;

    let matchScore = 0;
    let totalWeight = 0;

    // 각 관절 각도 범위 내에 있는지 확인
    for (const [joint, range] of Object.entries(exercise.keyAngles)) {
      const angle = angles[joint];
      if (angle === null || angle === undefined) continue;

      const weight = this._getJointWeight(joint);
      totalWeight += weight;

      // 각도가 범위 내에 있으면 점수 부여
      if (angle >= range.min && angle <= range.max) {
        matchScore += weight;
      } else {
        // 범위를 벗어나도 가까우면 부분 점수
        const distance = Math.min(
          Math.abs(angle - range.min),
          Math.abs(angle - range.max)
        );
        const partialScore = Math.max(0, 1 - distance / 30);
        matchScore += weight * partialScore * 0.5;
      }
    }

    // 자세 특성 검사 (추가 판별)
    matchScore += this._checkPostureCharacteristics(exerciseId, angles, landmarks) * 0.3;
    totalWeight += 0.3;

    return totalWeight > 0 ? matchScore / totalWeight : 0;
  }

  /**
   * 관절별 가중치 (운동 판별에서 더 중요한 관절)
   */
  _getJointWeight(joint) {
    const weights = {
      knee: 1.2,
      hip: 1.2,
      elbow: 1.0,
      shoulder: 1.0,
      ankle: 0.8,
      spine: 0.9
    };
    return weights[joint] || 0.8;
  }

  /**
   * 운동별 추가 자세 특성 검사
   */
  _checkPostureCharacteristics(exerciseId, angles, landmarks) {
    const L = window.poseEngine?.LANDMARKS;
    if (!L) return 0;

    switch (exerciseId) {
      case 'squat':
      case 'front_squat':
        // 발이 어깨 너비, 무릎이 발 방향
        return angles.knee < 160 ? 0.8 : 0.2;

      case 'deadlift':
      case 'romanian_deadlift':
        // 등이 거의 수평, 손이 무릎 아래
        return angles.spine < 170 ? 0.8 : 0.2;

      case 'bench_press':
      case 'push_up':
        // 누운 자세 또는 엎드린 자세
        return angles.elbow < 150 ? 0.7 : 0.3;

      case 'overhead_press':
        // 팔이 위로 올라간 자세
        return angles.shoulder > 120 ? 0.9 : 0.1;

      case 'plank':
        // 몸이 수평, 팔꿈치/손이 지면에
        return (angles.hip > 160 && angles.spine > 160) ? 0.9 : 0.1;

      case 'pull_up':
        // 팔이 위로 올라가 있음
        return angles.shoulder < 80 ? 0.8 : 0.2;

      default:
        return 0.5;
    }
  }

  /**
   * 감지 버퍼에서 가장 많이 등장한 운동 반환
   */
  _confirmExercise() {
    if (this.detectionBuffer.length < this.bufferSize * 0.6) return null;

    const counts = {};
    this.detectionBuffer.forEach(ex => {
      if (ex) counts[ex] = (counts[ex] || 0) + 1;
    });

    let maxCount = 0;
    let confirmed = null;

    for (const [exercise, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        confirmed = exercise;
      }
    }

    // 버퍼의 60% 이상이 같은 운동이어야 확정
    return maxCount >= this.bufferSize * 0.6 ? confirmed : null;
  }

  /**
   * 반복 횟수 감지 (상태 머신 방식)
   * @param {Object} angles - 현재 관절 각도
   * @returns {Object} 반복 카운트 결과
   */
  detectRep(angles) {
    if (!this.currentExercise) return null;

    const exercise = this.exerciseDB.exercises[this.currentExercise];
    if (!exercise || !exercise.repDetection) return null;

    const repDef = exercise.repDetection;

    // 이소메트릭 운동 (플랭크 등) - 시간 기반
    if (repDef.isIsometric) {
      return this._detectIsometricHold(exercise);
    }

    // 주요 관절 각도 가져오기
    const primaryAngle = angles[repDef.primaryJoint];
    if (primaryAngle === null || primaryAngle === undefined) return null;

    // 히스토리에 추가
    this.repStateMachine.primaryAngleHistory.push(primaryAngle);
    if (this.repStateMachine.primaryAngleHistory.length > this.repStateMachine.historySize) {
      this.repStateMachine.primaryAngleHistory.shift();
    }

    // 스무딩 (이동 평균)
    const smoothAngle = this._movingAverage(this.repStateMachine.primaryAngleHistory, 5);

    return this._processRepState(smoothAngle, repDef);
  }

  /**
   * 반복 상태 머신 처리
   */
  _processRepState(angle, repDef) {
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

  /**
   * 이소메트릭 운동 (플랭크 등) 시간 측정
   */
  _detectIsometricHold(exercise) {
    if (!this.repStateMachine.isometricStart) {
      this.repStateMachine.isometricStart = Date.now();
    }

    const holdTime = (Date.now() - this.repStateMachine.isometricStart) / 1000;

    return {
      holdTime: Math.round(holdTime),
      isIsometric: true,
      exercise: exercise.id
    };
  }

  /**
   * 반복 품질 점수 계산
   */
  _calculateRepQuality(sm, endAngle, endTime) {
    const duration = endTime - sm.repStartTime;
    const rangeOfMotion = sm.repStartAngle - sm.bottomAngle;

    // 가동범위 점수 (더 넓을수록 좋음)
    const romScore = Math.min(100, (rangeOfMotion / 60) * 100);

    // 속도 점수 (너무 빠르거나 느리면 감점)
    const optimalDuration = 2500; // 2.5초가 이상적
    const durationDiff = Math.abs(duration - optimalDuration);
    const tempoScore = Math.max(0, 100 - (durationDiff / 50));

    return Math.round((romScore * 0.6 + tempoScore * 0.4));
  }

  /**
   * 이동 평균 계산
   */
  _movingAverage(arr, n) {
    if (arr.length === 0) return 0;
    const slice = arr.slice(-n);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  /**
   * 반복 상태 초기화
   */
  _resetRepState(resetCount = true) {
    this.repStateMachine = {
      state: 'idle',
      primaryAngleHistory: [],
      historySize: 10,
      inRep: false,
      atBottom: false,
      lastRepTime: 0,
      isometricStart: null
    };
    if (resetCount) this.repCount = 0;
    if (resetCount) this.repHistory = [];
  }

  /**
   * 현재 세트 완료
   */
  completeSet(weight = 0) {
    if (!this.currentExercise || this.repCount === 0) return null;

    const setData = {
      exercise: this.currentExercise,
      reps: this.repCount,
      weight: weight,
      volume: this.repCount * weight,
      averageQuality: this._averageRepQuality(),
      duration: Date.now() - (this.repHistory[0]?.timestamp || Date.now()),
      repHistory: [...this.repHistory],
      timestamp: Date.now()
    };

    this.setCount++;
    this.sessionData.sets.push(setData);

    if (this.onSetComplete) {
      this.onSetComplete(setData);
    }

    // 반복 초기화
    this._resetRepState();

    return setData;
  }

  /**
   * 평균 반복 품질
   */
  _averageRepQuality() {
    if (this.repHistory.length === 0) return 0;
    const sum = this.repHistory.reduce((acc, rep) => acc + (rep.quality || 0), 0);
    return Math.round(sum / this.repHistory.length);
  }

  /**
   * 세션 초기화
   */
  resetSession() {
    this._resetRepState();
    this.setCount = 0;
    if (!this.manualMode) this.currentExercise = null;
    this.detectionBuffer = [];
    this.sessionData = {
      startTime: Date.now(),
      sets: [],
      currentSet: { exercise: null, reps: [], startTime: null }
    };
  }

  /**
   * 세션 데이터 반환
   */
  getSessionData() {
    return {
      ...this.sessionData,
      currentExercise: this.currentExercise,
      currentReps: this.repCount,
      setCount: this.setCount
    };
  }
}

window.ExerciseRecognition = ExerciseRecognition;
