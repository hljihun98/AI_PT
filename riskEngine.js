/**
 * riskEngine.js
 * 부상 위험 감지 및 예방 엔진
 * 
 * 담당: Physical Therapist + Orthopedic Specialist
 */

class RiskEngine {
  constructor(exerciseDB) {
    this.exerciseDB = exerciseDB;
    this.riskHistory = [];
    this.alertCooldowns = {}; // 같은 경고 반복 방지
    this.COOLDOWN_MS = 5000;  // 5초 쿨다운

    // 부상 위험 임계값 정의
    this.riskThresholds = {
      // 척추 관련
      lumbar_flexion: { angle: 155, severity: 'critical', joint: 'spine' },
      lumbar_hyperextension: { angle: 192, severity: 'high', joint: 'spine' },
      thoracic_rounding: { angle: 150, severity: 'medium', joint: 'spine' },

      // 무릎 관련
      knee_valgus: { angleDiff: 15, severity: 'high', joint: 'knee' },
      knee_hyperextension: { angle: 180, severity: 'high', joint: 'knee' },

      // 어깨 관련
      shoulder_impingement: { angle: 100, severity: 'high', joint: 'shoulder' },
      shoulder_elevation: { angleDiff: 15, severity: 'medium', joint: 'shoulder' },

      // 고관절 관련
      hip_shift: { deviation: 0.1, severity: 'medium', joint: 'hip' },
      pelvic_drop: { diff: 0.05, severity: 'medium', joint: 'hip' },

      // 발목 관련
      heel_lift: { threshold: 0.02, severity: 'medium', joint: 'ankle' }
    };

    // 신체 부위별 색상
    this.riskColors = {
      critical: '#FF0000',
      high: '#FF4444',
      medium: '#FF8800',
      low: '#FFD700',
      safe: '#00FF88'
    };

    this.onRiskDetected = null;
  }

  /**
   * 전체 부상 위험도 평가
   * @param {Object} poseData - 포즈 데이터
   * @param {string} exerciseId - 현재 운동 ID
   * @returns {Object} 위험도 평가 결과
   */
  assessRisk(poseData, exerciseId) {
    const { angles, landmarks, metrics } = poseData;
    if (!angles) return { overallRisk: 0, risks: [], safetyScore: 100 };

    const risks = [];

    // 1. 척추 위험 평가
    const spineRisks = this._assessSpineRisk(angles);
    risks.push(...spineRisks);

    // 2. 무릎 위험 평가
    const kneeRisks = this._assessKneeRisk(angles, landmarks);
    risks.push(...kneeRisks);

    // 3. 어깨 위험 평가
    const shoulderRisks = this._assessShoulderRisk(angles, landmarks);
    risks.push(...shoulderRisks);

    // 4. 고관절 위험 평가
    const hipRisks = this._assessHipRisk(angles, landmarks, metrics);
    risks.push(...hipRisks);

    // 5. 발목 위험 평가
    const ankleRisks = this._assessAnkleRisk(angles, landmarks);
    risks.push(...ankleRisks);

    // 전체 위험도 계산 (0~100)
    const overallRisk = this._calculateOverallRisk(risks);
    const safetyScore = 100 - overallRisk;

    // 위험 히스토리 업데이트
    this.riskHistory.push({ overallRisk, timestamp: Date.now() });
    if (this.riskHistory.length > 100) this.riskHistory.shift();

    // 심각한 위험 즉시 알림
    const criticalRisks = risks.filter(r => r.severity === 'critical');
    if (criticalRisks.length > 0) {
      this._triggerAlert(criticalRisks);
    }

    return {
      overallRisk,
      safetyScore,
      risks,
      risksByJoint: this._groupByJoint(risks),
      trend: this._calculateRiskTrend()
    };
  }

  /**
   * 척추 위험 평가
   */
  _assessSpineRisk(angles) {
    const risks = [];

    // 요추 굴곡 (허리가 굽는 경우)
    if (angles.spine !== null && angles.spine !== undefined) {
      if (angles.spine < 150) {
        risks.push({
          id: 'lumbar_flexion_critical',
          joint: 'spine',
          severity: 'critical',
          score: 90,
          message: '⚠️ 허리가 심하게 굽혀져 있습니다! 즉시 자세를 교정하세요.',
          angle: angles.spine,
          threshold: 150
        });
      } else if (angles.spine < 160) {
        risks.push({
          id: 'lumbar_flexion',
          joint: 'spine',
          severity: 'high',
          score: 60,
          message: '허리를 좀 더 세워주세요. 요추 부상 위험이 있습니다.',
          angle: angles.spine,
          threshold: 160
        });
      }

      // 요추 과신전
      if (angles.spine > 190) {
        risks.push({
          id: 'lumbar_hyperextension',
          joint: 'spine',
          severity: 'high',
          score: 55,
          message: '허리가 과도하게 뒤로 젖혀집니다. 복근에 힘을 주세요.',
          angle: angles.spine,
          threshold: 190
        });
      }
    }

    // 흉추 라운딩
    if (angles.shoulderTilt !== undefined && Math.abs(angles.shoulderTilt) > 10) {
      risks.push({
        id: 'thoracic_rounding',
        joint: 'spine',
        severity: 'medium',
        score: 35,
        message: '어깨가 한쪽으로 기울어 있습니다. 가슴을 펴주세요.',
        value: angles.shoulderTilt
      });
    }

    return risks;
  }

  /**
   * 무릎 위험 평가
   */
  _assessKneeRisk(angles, landmarks) {
    const risks = [];

    // 무릎 외반 (Valgus) - 좌우 무릎 각도 차이로 감지
    if (angles.leftKnee !== null && angles.rightKnee !== null) {
      const kneeDiff = Math.abs(angles.leftKnee - angles.rightKnee);
      if (kneeDiff > 20) {
        risks.push({
          id: 'knee_valgus',
          joint: 'knee',
          severity: 'high',
          score: 60,
          message: '무릎이 안쪽으로 모이고 있습니다. 발끝 방향으로 무릎을 유지하세요.',
          angleDiff: kneeDiff
        });
      }
    }

    // 무릎 과신전
    const maxKneeAngle = Math.max(angles.leftKnee || 0, angles.rightKnee || 0);
    if (maxKneeAngle > 180) {
      risks.push({
        id: 'knee_hyperextension',
        joint: 'knee',
        severity: 'high',
        score: 65,
        message: '무릎이 과신전되고 있습니다. 무릎을 살짝 굽혀 유지하세요.',
        angle: maxKneeAngle
      });
    }

    // 랜드마크 기반 무릎 외반 직접 감지
    if (landmarks) {
      const L = window.poseEngine?.LANDMARKS;
      if (L) {
        const valgusRisk = this._detectKneeValgusFromLandmarks(landmarks, L);
        if (valgusRisk) risks.push(valgusRisk);
      }
    }

    return risks;
  }

  /**
   * 랜드마크에서 직접 무릎 외반 감지
   */
  _detectKneeValgusFromLandmarks(landmarks, L) {
    const leftHip = landmarks[L.LEFT_HIP];
    const leftKnee = landmarks[L.LEFT_KNEE];
    const leftAnkle = landmarks[L.LEFT_ANKLE];
    const rightHip = landmarks[L.RIGHT_HIP];
    const rightKnee = landmarks[L.RIGHT_KNEE];
    const rightAnkle = landmarks[L.RIGHT_ANKLE];

    if (!leftHip || !leftKnee || !leftAnkle || !rightHip || !rightKnee || !rightAnkle) return null;

    // 왼쪽: 무릎이 발목보다 안쪽에 있으면 외반
    const leftValgus = leftKnee.x > leftAnkle.x + 0.03;
    // 오른쪽: 무릎이 발목보다 안쪽에 있으면 외반
    const rightValgus = rightKnee.x < rightAnkle.x - 0.03;

    if (leftValgus || rightValgus) {
      return {
        id: 'knee_valgus_landmark',
        joint: 'knee',
        severity: 'high',
        score: 65,
        message: '무릎이 안쪽으로 모이고 있습니다! 발끝과 무릎을 같은 방향으로 유지하세요.',
        side: leftValgus && rightValgus ? 'both' : (leftValgus ? 'left' : 'right')
      };
    }

    return null;
  }

  /**
   * 어깨 위험 평가
   */
  _assessShoulderRisk(angles, landmarks) {
    const risks = [];

    // 어깨 충돌 증후군 위험
    if (angles.shoulder !== null && angles.shoulder > 100) {
      risks.push({
        id: 'shoulder_impingement',
        joint: 'shoulder',
        severity: 'high',
        score: 55,
        message: '어깨가 과도하게 올라가 있습니다. 어깨를 내리고 견갑골을 안정시키세요.',
        angle: angles.shoulder
      });
    }

    // 어깨 기울기
    if (angles.shoulderTilt !== undefined && Math.abs(angles.shoulderTilt) > 15) {
      risks.push({
        id: 'shoulder_elevation',
        joint: 'shoulder',
        severity: 'medium',
        score: 30,
        message: `${angles.shoulderTilt > 0 ? '왼쪽' : '오른쪽'} 어깨가 높이 올라가 있습니다.`,
        tilt: angles.shoulderTilt
      });
    }

    // 내부 회전 과부하 (팔꿈치가 너무 안쪽에 있는 경우)
    if (angles.leftElbow !== null && angles.rightElbow !== null) {
      if (angles.leftElbow < 50 || angles.rightElbow < 50) {
        risks.push({
          id: 'internal_rotation_overload',
          joint: 'shoulder',
          severity: 'medium',
          score: 35,
          message: '어깨 내부 회전 각도가 과도합니다. 팔꿈치 위치를 조정하세요.'
        });
      }
    }

    return risks;
  }

  /**
   * 고관절 위험 평가
   */
  _assessHipRisk(angles, landmarks, metrics) {
    const risks = [];

    // 골반 기울기
    if (angles.pelvicTilt !== undefined && Math.abs(angles.pelvicTilt) > 8) {
      risks.push({
        id: 'pelvic_drop',
        joint: 'hip',
        severity: 'medium',
        score: 30,
        message: '골반이 기울어져 있습니다. 허리를 안정시키세요.',
        tilt: angles.pelvicTilt
      });
    }

    // 고관절 이동 (무게중심 기반)
    if (metrics && metrics.centerOfMass) {
      const comDeviation = Math.abs(metrics.centerOfMass.x - 0.5);
      if (comDeviation > 0.15) {
        risks.push({
          id: 'hip_shift',
          joint: 'hip',
          severity: 'medium',
          score: 35,
          message: '무게중심이 한쪽으로 치우쳐 있습니다. 균형을 잡으세요.',
          deviation: comDeviation
        });
      }
    }

    return risks;
  }

  /**
   * 발목 위험 평가
   */
  _assessAnkleRisk(angles, landmarks) {
    const risks = [];

    if (!landmarks) return risks;

    const L = window.poseEngine?.LANDMARKS;
    if (!L) return risks;

    // 발뒤꿈치 들림 감지
    const leftHeel = landmarks[L.LEFT_HEEL];
    const leftFootIndex = landmarks[L.LEFT_FOOT_INDEX];
    const rightHeel = landmarks[L.RIGHT_HEEL];
    const rightFootIndex = landmarks[L.RIGHT_FOOT_INDEX];

    if (leftHeel && leftFootIndex && leftHeel.visibility > 0.5) {
      // 발뒤꿈치가 발끝보다 높이 올라가면 들린 것
      if (leftHeel.y < leftFootIndex.y - 0.02) {
        risks.push({
          id: 'heel_lift_left',
          joint: 'ankle',
          severity: 'medium',
          score: 30,
          message: '왼쪽 발뒤꿈치가 들리고 있습니다. 발바닥 전체로 지면을 밟으세요.'
        });
      }
    }

    if (rightHeel && rightFootIndex && rightHeel.visibility > 0.5) {
      if (rightHeel.y < rightFootIndex.y - 0.02) {
        risks.push({
          id: 'heel_lift_right',
          joint: 'ankle',
          severity: 'medium',
          score: 30,
          message: '오른쪽 발뒤꿈치가 들리고 있습니다.'
        });
      }
    }

    // 발목 붕괴 (Ankle Collapse) - 발목 각도 기반
    if (angles.ankle !== null && angles.ankle !== undefined && angles.ankle < 70) {
      risks.push({
        id: 'ankle_collapse',
        joint: 'ankle',
        severity: 'medium',
        score: 35,
        message: '발목이 안쪽으로 무너지고 있습니다. 아치를 유지하세요.'
      });
    }

    return risks;
  }

  /**
   * 전체 위험도 계산
   */
  _calculateOverallRisk(risks) {
    if (risks.length === 0) return 0;

    const severityScores = {
      critical: 90,
      high: 60,
      medium: 30,
      low: 10
    };

    // 가장 심각한 위험을 기준으로 계산
    let maxRisk = 0;
    let additionalRisk = 0;

    risks.forEach(risk => {
      const riskScore = risk.score || severityScores[risk.severity] || 0;
      if (riskScore > maxRisk) {
        additionalRisk += maxRisk * 0.1;
        maxRisk = riskScore;
      } else {
        additionalRisk += riskScore * 0.1;
      }
    });

    return Math.min(100, Math.round(maxRisk + additionalRisk));
  }

  /**
   * 관절별 위험 그룹화
   */
  _groupByJoint(risks) {
    const grouped = {};
    risks.forEach(risk => {
      if (!grouped[risk.joint]) {
        grouped[risk.joint] = [];
      }
      grouped[risk.joint].push(risk);
    });
    return grouped;
  }

  /**
   * 위험도 트렌드 계산
   */
  _calculateRiskTrend() {
    if (this.riskHistory.length < 5) return 0;
    const recent = this.riskHistory.slice(-5).map(r => r.overallRisk);
    return recent[recent.length - 1] - recent[0];
  }

  /**
   * 위험 알림 트리거
   */
  _triggerAlert(risks) {
    const now = Date.now();

    risks.forEach(risk => {
      const lastAlert = this.alertCooldowns[risk.id] || 0;

      if (now - lastAlert > this.COOLDOWN_MS) {
        this.alertCooldowns[risk.id] = now;

        if (this.onRiskDetected) {
          this.onRiskDetected({
            risk,
            timestamp: now
          });
        }
      }
    });
  }

  /**
   * 위험도에 따른 색상 반환
   */
  getRiskColor(riskScore) {
    if (riskScore >= 80) return this.riskColors.critical;
    if (riskScore >= 60) return this.riskColors.high;
    if (riskScore >= 35) return this.riskColors.medium;
    if (riskScore >= 15) return this.riskColors.low;
    return this.riskColors.safe;
  }

  /**
   * 안전 점수에 따른 레이블
   */
  getSafetyLabel(safetyScore) {
    if (safetyScore >= 90) return { label: '안전', color: '#00FF88' };
    if (safetyScore >= 75) return { label: '주의', color: '#FFD700' };
    if (safetyScore >= 55) return { label: '경고', color: '#FF8800' };
    return { label: '위험', color: '#FF0000' };
  }
}

window.RiskEngine = RiskEngine;
