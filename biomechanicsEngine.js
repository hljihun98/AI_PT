/**
 * biomechanicsEngine.js
 * 생체역학 분석 엔진 - 운동 자세 점수화 및 움직임 품질 평가
 * 
 * 담당: Biomechanics Researcher + Physical Therapist
 */

class BiomechanicsEngine {
  constructor(exerciseDB) {
    this.exerciseDB = exerciseDB;

    // 점수 가중치 (총합 100)
    this.scoreWeights = {
      posture: 30,          // 자세 정확도
      rangeOfMotion: 20,    // 가동범위
      stability: 20,        // 안정성
      symmetry: 15,         // 좌우 대칭
      tempo: 10,            // 템포
      control: 5            // 제어력
    };

    // 피로도 분석용
    this.fatigueTracker = {
      baselineSpeed: null,
      baselineROM: null,
      baselineSymmetry: null,
      historyWindow: 5,
      repHistory: []
    };

    // 콜백
    this.onFormFeedback = null;
    this.onFatigueAlert = null;
  }

  /**
   * 종합 자세 점수 계산
   * @param {Object} poseData - 포즈 데이터 {angles, metrics, landmarks}
   * @param {string} exerciseId - 현재 운동 ID
   * @returns {Object} 종합 점수 및 세부 점수
   */
  calculateFormScore(poseData, exerciseId) {
    const exercise = this.exerciseDB.exercises[exerciseId];
    if (!exercise || !poseData.angles) {
      return { total: 0, components: {}, feedback: [] };
    }

    const { angles, metrics } = poseData;
    const feedback = [];

    // 각 항목별 점수 계산
    const postureScore = this._evaluatePosture(angles, exercise, feedback);
    const romScore = this._evaluateRangeOfMotion(angles, exercise, feedback);
    const stabilityScore = this._evaluateStability(metrics, feedback);
    const symmetryScore = metrics.symmetry || 100;
    const tempoScore = this._evaluateTempo(feedback);
    const controlScore = this._evaluateControl(metrics, feedback);

    // 대칭성 피드백
    if (symmetryScore < 80) {
      feedback.push({
        type: 'warning',
        category: 'symmetry',
        message: '좌우 균형이 무너지고 있습니다. 양측을 균등하게 사용하세요.',
        priority: 2
      });
    }

    // 총점 계산
    const total = Math.round(
      postureScore * (this.scoreWeights.posture / 100) +
      romScore * (this.scoreWeights.rangeOfMotion / 100) +
      stabilityScore * (this.scoreWeights.stability / 100) +
      symmetryScore * (this.scoreWeights.symmetry / 100) +
      tempoScore * (this.scoreWeights.tempo / 100) +
      controlScore * (this.scoreWeights.control / 100)
    );

    // 피드백 우선순위 정렬
    feedback.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const result = {
      total: Math.max(0, Math.min(100, total)),
      components: {
        posture: postureScore,
        rangeOfMotion: romScore,
        stability: stabilityScore,
        symmetry: symmetryScore,
        tempo: tempoScore,
        control: controlScore
      },
      feedback: feedback.slice(0, 3), // 최대 3개 피드백
      grade: this._getGrade(total)
    };

    // 피로도 업데이트
    this._updateFatigue(result, poseData);

    return result;
  }

  /**
   * 자세 정확도 평가 (0~100)
   */
  _evaluatePosture(angles, exercise, feedback) {
    let score = 100;
    const { keyAngles, commonErrors } = exercise;

    if (!keyAngles) return 75;

    // 각 관절 각도가 허용 범위 내인지 확인
    for (const [joint, range] of Object.entries(keyAngles)) {
      const angle = angles[joint];
      if (angle === null || angle === undefined) continue;

      if (angle < range.min || angle > range.max) {
        // 범위를 벗어난 정도 계산
        const deviation = angle < range.min
          ? range.min - angle
          : angle - range.max;

        // 10도 이상 벗어나면 큰 감점
        const penalty = Math.min(25, deviation * 1.5);
        score -= penalty;

        // 에러 피드백 생성
        const errorFeedback = this._getJointErrorFeedback(joint, angle, range);
        if (errorFeedback) {
          feedback.push({ ...errorFeedback, priority: 3 });
        }
      }
    }

    // 운동별 특정 에러 체크
    if (commonErrors) {
      commonErrors.forEach(error => {
        const detected = this._checkSpecificError(error.id, angles);
        if (detected) {
          feedback.push({
            type: 'error',
            category: error.id,
            message: error.message,
            priority: 4
          });
          score -= 15;
        }
      });
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * 관절 각도 오류 피드백 생성
   */
  _getJointErrorFeedback(joint, angle, range) {
    const messages = {
      knee: angle < range.min
        ? { type: 'warning', category: 'knee', message: '무릎이 과도하게 굽혀져 있습니다.' }
        : { type: 'warning', category: 'knee', message: '무릎을 더 굽혀주세요. 가동범위를 확보하세요.' },

      hip: angle < range.min
        ? { type: 'warning', category: 'hip', message: '고관절을 더 펴주세요.' }
        : { type: 'warning', category: 'hip', message: '상체를 세워주세요.' },

      spine: angle < range.min
        ? { type: 'error', category: 'spine', message: '허리가 굽어있습니다! 척추 중립을 유지하세요.' }
        : null,

      elbow: angle > range.max
        ? { type: 'warning', category: 'elbow', message: '팔꿈치가 너무 펴져 있습니다. 잠금 방지하세요.' }
        : { type: 'info', category: 'elbow', message: '팔꿈치를 더 굽혀주세요.' },

      shoulder: angle > range.max
        ? { type: 'warning', category: 'shoulder', message: '어깨가 과도하게 올라가 있습니다.' }
        : null
    };

    return messages[joint] || null;
  }

  /**
   * 특정 에러 패턴 감지
   */
  _checkSpecificError(errorId, angles) {
    switch (errorId) {
      case 'knee_valgus':
        // 무릎이 안쪽으로 모이는 경우 - 좌우 무릎 각도 차이로 판단
        if (angles.leftKnee !== null && angles.rightKnee !== null) {
          return Math.abs(angles.leftKnee - angles.rightKnee) > 20;
        }
        return false;

      case 'lumbar_flexion':
        // 허리 굴곡 - 척추 각도가 낮으면
        return angles.spine !== null && angles.spine < 155;

      case 'lumbar_hyperextension':
        // 허리 과신전 - 척추 각도가 너무 크면
        return angles.spine !== null && angles.spine > 190;

      case 'hip_sag':
        // 엉덩이가 처지는 경우 - 고관절 각도
        return angles.hip !== null && angles.hip < 160;

      case 'elbow_flare':
        // 팔꿈치가 너무 벌어진 경우
        if (angles.leftElbow !== null && angles.rightElbow !== null) {
          return angles.leftElbow < 60 || angles.rightElbow < 60;
        }
        return false;

      case 'shoulder_shrug':
        // 어깨가 올라가는 경우 - 어깨 각도
        return angles.shoulder !== null && angles.shoulder > 100;

      default:
        return false;
    }
  }

  /**
   * 가동범위 평가 (0~100)
   */
  _evaluateRangeOfMotion(angles, exercise, feedback) {
    const { keyAngles, repDetection } = exercise;
    if (!keyAngles || !repDetection) return 75;

    const primaryJoint = repDetection.primaryJoint;
    const range = keyAngles[primaryJoint];
    if (!range) return 75;

    const angle = angles[primaryJoint];
    if (angle === null || angle === undefined) return 50;

    // 현재 운동 상태에서의 최적 각도 도달 여부
    const targetRange = range.max - range.min;
    const achievedRange = Math.abs(angle - range.min);

    let score = (achievedRange / targetRange) * 100;

    if (score < 50) {
      feedback.push({
        type: 'info',
        category: 'rom',
        message: '가동범위를 조금 더 확보해보세요.',
        priority: 1
      });
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * 안정성 평가 (0~100)
   */
  _evaluateStability(metrics, feedback) {
    if (!metrics) return 75;

    let score = 100;

    // 속도 기반 안정성 (너무 빠르면 불안정)
    if (metrics.velocity > 0.05) {
      score -= Math.min(30, (metrics.velocity - 0.05) * 300);
    }

    // 무게중심 이탈 감지
    if (metrics.centerOfMass) {
      const com = metrics.centerOfMass;
      // 무게중심이 중앙에서 멀수록 감점
      const deviation = Math.abs(com.x - 0.5);
      if (deviation > 0.15) {
        score -= Math.min(20, (deviation - 0.15) * 100);
        feedback.push({
          type: 'warning',
          category: 'stability',
          message: '무게중심이 한쪽으로 치우쳐 있습니다.',
          priority: 2
        });
      }
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * 템포 평가 (0~100)
   * - 실제로는 반복 속도 히스토리 기반으로 계산
   */
  _evaluateTempo(feedback) {
    // 기본값 80 (실제 구현에서는 반복 지속시간 기반으로 계산)
    return 80;
  }

  /**
   * 제어력 평가 (0~100)
   */
  _evaluateControl(metrics, feedback) {
    if (!metrics || metrics.velocity === undefined) return 75;

    // 속도의 일관성으로 제어력 판단
    let score = 100;

    if (metrics.velocity > 0.08) {
      score -= 20;
      feedback.push({
        type: 'info',
        category: 'control',
        message: '동작을 천천히 제어하며 실시하세요.',
        priority: 1
      });
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * 피로도 업데이트 및 분석
   */
  _updateFatigue(formScore, poseData) {
    this.fatigueTracker.repHistory.push({
      score: formScore.total,
      symmetry: formScore.components.symmetry,
      timestamp: Date.now()
    });

    // 히스토리 유지
    if (this.fatigueTracker.repHistory.length > this.fatigueTracker.historyWindow * 2) {
      this.fatigueTracker.repHistory.shift();
    }

    // 피로도 감지 (점수가 지속적으로 하락하면)
    if (this.fatigueTracker.repHistory.length >= this.fatigueTracker.historyWindow) {
      const recent = this.fatigueTracker.repHistory.slice(-this.fatigueTracker.historyWindow);
      const trend = this._calculateTrend(recent.map(r => r.score));

      if (trend < -5 && this.onFatigueAlert) {
        this.onFatigueAlert({
          level: trend < -10 ? 'high' : 'medium',
          message: '피로도가 감지됩니다. 잠시 휴식을 취하세요.',
          trend: trend
        });
      }
    }
  }

  /**
   * 데이터 트렌드 계산 (선형 회귀)
   */
  _calculateTrend(data) {
    if (data.length < 2) return 0;
    const n = data.length;
    const sumX = n * (n - 1) / 2;
    const sumY = data.reduce((a, b) => a + b, 0);
    const sumXY = data.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = data.reduce((sum, _, x) => sum + x * x, 0);

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  /**
   * 점수에 따른 등급 반환
   */
  _getGrade(score) {
    if (score >= 90) return { grade: 'S', label: '완벽', color: '#FFD700' };
    if (score >= 80) return { grade: 'A', label: '우수', color: '#00FF88' };
    if (score >= 70) return { grade: 'B', label: '양호', color: '#00BFFF' };
    if (score >= 60) return { grade: 'C', label: '보통', color: '#FFA500' };
    return { grade: 'D', label: '개선필요', color: '#FF4444' };
  }

  /**
   * 세션 통계 계산
   */
  calculateSessionStats(sets) {
    if (!sets || sets.length === 0) return null;

    const totalVolume = sets.reduce((sum, s) => sum + (s.volume || 0), 0);
    const totalReps = sets.reduce((sum, s) => sum + (s.reps || 0), 0);
    const avgQuality = sets.reduce((sum, s) => sum + (s.averageQuality || 0), 0) / sets.length;

    // 근육 그룹별 볼륨
    const muscleGroupVolume = {};
    sets.forEach(set => {
      const exercise = this.exerciseDB.exercises[set.exercise];
      if (exercise && exercise.muscleGroups) {
        exercise.muscleGroups.forEach(muscle => {
          muscleGroupVolume[muscle] = (muscleGroupVolume[muscle] || 0) + (set.volume || set.reps || 0);
        });
      }
    });

    return {
      totalVolume,
      totalReps,
      totalSets: sets.length,
      averageFormScore: Math.round(avgQuality),
      muscleGroupVolume,
      exerciseCount: [...new Set(sets.map(s => s.exercise))].length
    };
  }
}

window.BiomechanicsEngine = BiomechanicsEngine;
