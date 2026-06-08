/**
 * PoseEngine.js
 * MediaPipe Pose 기반 실시간 포즈 추적 및 관절 각도 계산 엔진
 * 
 * 담당: Senior Computer Vision Engineer + Biomechanics Researcher
 */

class PoseEngine {
  constructor() {
    this.pose = null;
    this.camera = null;
    this.isRunning = false;
    this.currentLandmarks = null;
    this.poseHistory = []; // 최근 30프레임 저장
    this.maxHistory = 30;
    this.fps = 0;
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.fpsInterval = null;

    // 콜백 함수들
    this.onPoseDetected = null;
    this.onAnglesCalculated = null;
    this.onError = null;

    // MediaPipe Landmark 인덱스 매핑
    this.LANDMARKS = {
      NOSE: 0,
      LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
      RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
      LEFT_EAR: 7, RIGHT_EAR: 8,
      MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
      LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
      LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
      LEFT_WRIST: 15, RIGHT_WRIST: 16,
      LEFT_PINKY: 17, RIGHT_PINKY: 18,
      LEFT_INDEX: 19, RIGHT_INDEX: 20,
      LEFT_THUMB: 21, RIGHT_THUMB: 22,
      LEFT_HIP: 23, RIGHT_HIP: 24,
      LEFT_KNEE: 25, RIGHT_KNEE: 26,
      LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
      LEFT_HEEL: 29, RIGHT_HEEL: 30,
      LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32
    };

    // 최소 가시성 임계값
    this.MIN_VISIBILITY = 0.5;
  }

  /**
   * MediaPipe Pose 초기화
   */
  async initialize() {
    try {
      this.pose = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
      });

      this.pose.setOptions({
        modelComplexity: 1,          // 0=Lite, 1=Full, 2=Heavy
        smoothLandmarks: true,        // 랜드마크 스무딩
        enableSegmentation: false,    // 세그멘테이션 비활성화 (성능)
        smoothSegmentation: false,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      this.pose.onResults((results) => this._onResults(results));
      console.log('[PoseEngine] MediaPipe Pose 초기화 완료');
      return true;
    } catch (error) {
      console.error('[PoseEngine] 초기화 실패:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }

  /**
   * 카메라 시작
   * @param {HTMLVideoElement} videoElement - 비디오 엘리먼트
   * @param {string} facingMode - 'user' (전면) | 'environment' (후면)
   */
  async startCamera(videoElement, facingMode = 'user') {
    try {
      // 기존 카메라 정지
      if (this.camera) {
        await this.camera.stop();
      }

      this.camera = new Camera(videoElement, {
        onFrame: async () => {
          if (this.pose && this.isRunning) {
            await this.pose.send({ image: videoElement });
            this._updateFPS();
          }
        },
        width: 1280,
        height: 720,
        facingMode: facingMode
      });

      await this.camera.start();
      this.isRunning = true;
      console.log(`[PoseEngine] 카메라 시작 (${facingMode})`);
      return true;
    } catch (error) {
      console.error('[PoseEngine] 카메라 시작 실패:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }

  /**
   * 카메라 정지
   */
  async stopCamera() {
    this.isRunning = false;
    if (this.camera) {
      await this.camera.stop();
      this.camera = null;
    }
    console.log('[PoseEngine] 카메라 정지');
  }

  /**
   * MediaPipe 결과 처리 콜백
   */
  _onResults(results) {
    if (!results.poseLandmarks) {
      this.currentLandmarks = null;
      return;
    }

    this.currentLandmarks = results.poseLandmarks;

    // 히스토리에 추가
    this.poseHistory.push({
      landmarks: results.poseLandmarks,
      timestamp: Date.now()
    });

    // 히스토리 크기 유지
    if (this.poseHistory.length > this.maxHistory) {
      this.poseHistory.shift();
    }

    // 관절 각도 계산
    const angles = this.calculateAllAngles(results.poseLandmarks);
    const metrics = this.calculateDerivedMetrics(results.poseLandmarks);

    // 콜백 호출
    if (this.onPoseDetected) {
      this.onPoseDetected({
        landmarks: results.poseLandmarks,
        worldLandmarks: results.poseWorldLandmarks,
        angles,
        metrics,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 세 점을 이용한 각도 계산 (도 단위)
   * @param {Object} a - 시작점 {x, y, z}
   * @param {Object} b - 중간점 (꼭짓점) {x, y, z}
   * @param {Object} c - 끝점 {x, y, z}
   * @returns {number} 각도 (0~180도)
   */
  calculateAngle(a, b, c) {
    if (!a || !b || !c) return null;

    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);

    if (angle > 180.0) {
      angle = 360 - angle;
    }

    return Math.round(angle);
  }

  /**
   * 3D 각도 계산 (월드 좌표 사용)
   */
  calculateAngle3D(a, b, c) {
    if (!a || !b || !c) return null;

    const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
    const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };

    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2 + v1.z ** 2);
    const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);

    if (mag1 === 0 || mag2 === 0) return null;

    const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.round(Math.acos(cosAngle) * 180 / Math.PI);
  }

  /**
   * 랜드마크 가시성 확인
   */
  isVisible(landmark) {
    return landmark && landmark.visibility >= this.MIN_VISIBILITY;
  }

  /**
   * 안전하게 랜드마크 가져오기
   */
  getLandmark(landmarks, index) {
    const lm = landmarks[index];
    return this.isVisible(lm) ? lm : null;
  }

  /**
   * 전체 관절 각도 계산
   * @param {Array} landmarks - MediaPipe 랜드마크 배열
   * @returns {Object} 모든 관절 각도
   */
  calculateAllAngles(landmarks) {
    const L = this.LANDMARKS;
    const get = (idx) => this.getLandmark(landmarks, idx);

    const angles = {};

    // === 오른쪽 관절 ===

    // 오른쪽 팔꿈치 각도 (어깨-팔꿈치-손목)
    const rShoulder = get(L.RIGHT_SHOULDER);
    const rElbow = get(L.RIGHT_ELBOW);
    const rWrist = get(L.RIGHT_WRIST);
    if (rShoulder && rElbow && rWrist) {
      angles.rightElbow = this.calculateAngle(rShoulder, rElbow, rWrist);
    }

    // 오른쪽 어깨 각도 (엉덩이-어깨-팔꿈치)
    const rHip = get(L.RIGHT_HIP);
    if (rHip && rShoulder && rElbow) {
      angles.rightShoulder = this.calculateAngle(rHip, rShoulder, rElbow);
    }

    // 오른쪽 무릎 각도 (엉덩이-무릎-발목)
    const rKnee = get(L.RIGHT_KNEE);
    const rAnkle = get(L.RIGHT_ANKLE);
    if (rHip && rKnee && rAnkle) {
      angles.rightKnee = this.calculateAngle(rHip, rKnee, rAnkle);
    }

    // 오른쪽 고관절 각도 (어깨-엉덩이-무릎)
    if (rShoulder && rHip && rKnee) {
      angles.rightHip = this.calculateAngle(rShoulder, rHip, rKnee);
    }

    // 오른쪽 발목 각도 (무릎-발목-발끝)
    const rFootIndex = get(L.RIGHT_FOOT_INDEX);
    if (rKnee && rAnkle && rFootIndex) {
      angles.rightAnkle = this.calculateAngle(rKnee, rAnkle, rFootIndex);
    }

    // === 왼쪽 관절 ===

    const lShoulder = get(L.LEFT_SHOULDER);
    const lElbow = get(L.LEFT_ELBOW);
    const lWrist = get(L.LEFT_WRIST);
    const lHip = get(L.LEFT_HIP);
    const lKnee = get(L.LEFT_KNEE);
    const lAnkle = get(L.LEFT_ANKLE);
    const lFootIndex = get(L.LEFT_FOOT_INDEX);

    if (lShoulder && lElbow && lWrist) {
      angles.leftElbow = this.calculateAngle(lShoulder, lElbow, lWrist);
    }

    if (lHip && lShoulder && lElbow) {
      angles.leftShoulder = this.calculateAngle(lHip, lShoulder, lElbow);
    }

    if (lHip && lKnee && lAnkle) {
      angles.leftKnee = this.calculateAngle(lHip, lKnee, lAnkle);
    }

    if (lShoulder && lHip && lKnee) {
      angles.leftHip = this.calculateAngle(lShoulder, lHip, lKnee);
    }

    if (lKnee && lAnkle && lFootIndex) {
      angles.leftAnkle = this.calculateAngle(lKnee, lAnkle, lFootIndex);
    }

    // === 양측 평균값 ===
    angles.elbow = this._average(angles.leftElbow, angles.rightElbow);
    angles.shoulder = this._average(angles.leftShoulder, angles.rightShoulder);
    angles.knee = this._average(angles.leftKnee, angles.rightKnee);
    angles.hip = this._average(angles.leftHip, angles.rightHip);
    angles.ankle = this._average(angles.leftAnkle, angles.rightAnkle);

    // === 척추 각도 ===
    // 목 중간점 (양 어깨 중점) - 허리 중간점 (양 엉덩이 중점)
    if (lShoulder && rShoulder && lHip && rHip) {
      const midShoulder = this._midpoint(lShoulder, rShoulder);
      const midHip = this._midpoint(lHip, rHip);
      const nose = get(L.NOSE);

      if (nose) {
        angles.spine = this.calculateAngle(nose, midShoulder, midHip);
      }

      // 골반 기울기: 좌우 엉덩이 높이 차이
      angles.pelvicTilt = Math.round((lHip.y - rHip.y) * 100);

      // 어깨 기울기: 좌우 어깨 높이 차이
      angles.shoulderTilt = Math.round((lShoulder.y - rShoulder.y) * 100);
    }

    return angles;
  }

  /**
   * 파생 메트릭 계산 (무게중심, 속도, 대칭성 등)
   */
  calculateDerivedMetrics(landmarks) {
    const L = this.LANDMARKS;
    const metrics = {};

    // 무게중심 계산 (주요 관절들의 가중 평균)
    const keyPoints = [
      L.LEFT_SHOULDER, L.RIGHT_SHOULDER,
      L.LEFT_HIP, L.RIGHT_HIP,
      L.LEFT_KNEE, L.RIGHT_KNEE
    ];

    let sumX = 0, sumY = 0, count = 0;
    keyPoints.forEach(idx => {
      const lm = this.getLandmark(landmarks, idx);
      if (lm) { sumX += lm.x; sumY += lm.y; count++; }
    });

    if (count > 0) {
      metrics.centerOfMass = { x: sumX / count, y: sumY / count };
    }

    // 좌우 대칭성 계산 (0~100, 100이 완벽한 대칭)
    metrics.symmetry = this._calculateSymmetry(landmarks);

    // 속도 계산 (이전 프레임 대비)
    if (this.poseHistory.length >= 2) {
      const prev = this.poseHistory[this.poseHistory.length - 2].landmarks;
      metrics.velocity = this._calculateVelocity(prev, landmarks);
    }

    // 자세 신뢰도
    metrics.confidence = this._calculateConfidence(landmarks);

    return metrics;
  }

  /**
   * 좌우 대칭성 계산
   */
  _calculateSymmetry(landmarks) {
    const L = this.LANDMARKS;
    const pairs = [
      [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
      [L.LEFT_ELBOW, L.RIGHT_ELBOW],
      [L.LEFT_HIP, L.RIGHT_HIP],
      [L.LEFT_KNEE, L.RIGHT_KNEE]
    ];

    let totalDiff = 0, count = 0;

    pairs.forEach(([leftIdx, rightIdx]) => {
      const left = this.getLandmark(landmarks, leftIdx);
      const right = this.getLandmark(landmarks, rightIdx);

      if (left && right) {
        // Y축 위치 차이 (정규화)
        const diff = Math.abs(left.y - right.y);
        totalDiff += diff;
        count++;
      }
    });

    if (count === 0) return 100;

    // 0~0.1 범위의 차이를 100~0 점수로 변환
    const avgDiff = totalDiff / count;
    return Math.max(0, Math.round(100 - avgDiff * 1000));
  }

  /**
   * 관절 속도 계산
   */
  _calculateVelocity(prevLandmarks, currLandmarks) {
    const keyJoints = [
      this.LANDMARKS.LEFT_WRIST, this.LANDMARKS.RIGHT_WRIST,
      this.LANDMARKS.LEFT_KNEE, this.LANDMARKS.RIGHT_KNEE
    ];

    let totalVelocity = 0;
    let count = 0;

    keyJoints.forEach(idx => {
      const prev = prevLandmarks[idx];
      const curr = currLandmarks[idx];

      if (prev && curr && prev.visibility > 0.5 && curr.visibility > 0.5) {
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        totalVelocity += Math.sqrt(dx * dx + dy * dy);
        count++;
      }
    });

    return count > 0 ? totalVelocity / count : 0;
  }

  /**
   * 자세 감지 신뢰도 계산
   */
  _calculateConfidence(landmarks) {
    const keyIndices = [
      this.LANDMARKS.LEFT_SHOULDER, this.LANDMARKS.RIGHT_SHOULDER,
      this.LANDMARKS.LEFT_HIP, this.LANDMARKS.RIGHT_HIP,
      this.LANDMARKS.LEFT_KNEE, this.LANDMARKS.RIGHT_KNEE
    ];

    let totalVisibility = 0;
    keyIndices.forEach(idx => {
      totalVisibility += (landmarks[idx]?.visibility || 0);
    });

    return Math.round((totalVisibility / keyIndices.length) * 100);
  }

  /**
   * 두 수의 평균 (null 처리 포함)
   */
  _average(a, b) {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.round((a + b) / 2);
  }

  /**
   * 두 점의 중간점 계산
   */
  _midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: ((a.z || 0) + (b.z || 0)) / 2,
      visibility: Math.min(a.visibility, b.visibility)
    };
  }

  /**
   * FPS 업데이트
   */
  _updateFPS() {
    this.frameCount++;
    const now = Date.now();

    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  /**
   * 캔버스에 포즈 스켈레톤 그리기
   * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
   * @param {Array} landmarks - 랜드마크 배열
   * @param {Object} formScore - 자세 점수 (색상 결정에 사용)
   */
  drawPose(ctx, landmarks, formScore = null) {
    if (!landmarks || !ctx) return;

    const canvas = ctx.canvas;
    const w = canvas.width;
    const h = canvas.height;

    // 연결선 정의 (MediaPipe Pose 연결)
    const connections = [
      // 얼굴
      [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
      // 몸통
      [11, 12], [11, 23], [12, 24], [23, 24],
      // 왼팔
      [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
      // 오른팔
      [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
      // 왼다리
      [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
      // 오른다리
      [24, 26], [26, 28], [28, 30], [28, 32], [30, 32]
    ];

    // 점수에 따른 색상 설정
    let lineColor, dotColor;
    if (formScore === null) {
      lineColor = 'rgba(0, 255, 255, 0.8)';
      dotColor = '#00ffff';
    } else if (formScore >= 80) {
      lineColor = 'rgba(0, 255, 100, 0.9)';
      dotColor = '#00ff64';
    } else if (formScore >= 60) {
      lineColor = 'rgba(255, 200, 0, 0.9)';
      dotColor = '#ffc800';
    } else {
      lineColor = 'rgba(255, 50, 50, 0.9)';
      dotColor = '#ff3232';
    }

    // 연결선 그리기
    ctx.lineWidth = 3;
    ctx.strokeStyle = lineColor;
    ctx.shadowBlur = 8;
    ctx.shadowColor = lineColor;

    connections.forEach(([i, j]) => {
      const a = landmarks[i];
      const b = landmarks[j];

      if (a && b && a.visibility > 0.3 && b.visibility > 0.3) {
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    });

    // 관절 점 그리기
    ctx.shadowBlur = 12;
    ctx.shadowColor = dotColor;

    landmarks.forEach((lm, idx) => {
      if (lm && lm.visibility > 0.3) {
        const x = lm.x * w;
        const y = lm.y * h;

        // 주요 관절은 더 크게
        const isKeyJoint = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(idx);
        const radius = isKeyJoint ? 7 : 4;

        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 주요 관절에 흰 테두리
        if (isKeyJoint) {
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1.5;
          ctx.shadowBlur = 0;
          ctx.stroke();
          ctx.shadowBlur = 12;
          ctx.shadowColor = dotColor;
        }
      }
    });

    ctx.shadowBlur = 0;
  }

  /**
   * 현재 포즈 데이터 반환
   */
  getCurrentPose() {
    return {
      landmarks: this.currentLandmarks,
      history: this.poseHistory,
      fps: this.fps
    };
  }

  /**
   * 리소스 정리
   */
  async destroy() {
    await this.stopCamera();
    if (this.pose) {
      await this.pose.close();
      this.pose = null;
    }
    this.poseHistory = [];
  }
}

// 전역 인스턴스
window.poseEngine = new PoseEngine();
