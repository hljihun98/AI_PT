/**
 * dashboard.js
 * 운동 데이터 추적, 통계 시각화 및 기록 관리
 * 
 * 담당: Senior Full Stack Developer + Sports Scientist
 */

class Dashboard {
  constructor() {
    this.db = null;
    this.dbName = 'AIPTProDB';
    this.dbVersion = 1;
    this.workoutHistory = [];
    this.currentSession = null;
    this.charts = {};
  }

  /**
   * IndexedDB 초기화
   */
  async initialize() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('[Dashboard] DB 초기화 실패');
        resolve(false);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[Dashboard] DB 초기화 완료');
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 운동 세션 저장소
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', {
            keyPath: 'id',
            autoIncrement: true
          });
          sessionStore.createIndex('date', 'date', { unique: false });
          sessionStore.createIndex('exercise', 'exercise', { unique: false });
        }

        // 운동 세트 저장소
        if (!db.objectStoreNames.contains('sets')) {
          const setsStore = db.createObjectStore('sets', {
            keyPath: 'id',
            autoIncrement: true
          });
          setsStore.createIndex('sessionId', 'sessionId', { unique: false });
          setsStore.createIndex('exercise', 'exercise', { unique: false });
          setsStore.createIndex('date', 'date', { unique: false });
        }

        // 바디 측정 저장소
        if (!db.objectStoreNames.contains('bodyMeasurements')) {
          db.createObjectStore('bodyMeasurements', {
            keyPath: 'id',
            autoIncrement: true
          });
        }
      };
    });
  }

  /**
   * 세션 시작
   */
  startSession() {
    this.currentSession = {
      startTime: Date.now(),
      date: new Date().toISOString().split('T')[0],
      sets: [],
      totalVolume: 0,
      totalReps: 0,
      formScores: [],
      exercisesPerformed: new Set()
    };
    console.log('[Dashboard] 새 세션 시작');
  }

  /**
   * 세트 데이터 추가
   */
  async addSet(setData) {
    if (!this.currentSession) this.startSession();

    const set = {
      ...setData,
      sessionId: this.currentSession.startTime,
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now()
    };

    this.currentSession.sets.push(set);
    this.currentSession.totalVolume += set.volume || 0;
    this.currentSession.totalReps += set.reps || 0;
    if (set.averageQuality) this.currentSession.formScores.push(set.averageQuality);
    if (set.exercise) this.currentSession.exercisesPerformed.add(set.exercise);

    // DB에 저장
    await this._saveSet(set);

    return set;
  }

  /**
   * DB에 세트 저장
   */
  async _saveSet(setData) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sets'], 'readwrite');
      const store = transaction.objectStore('sets');
      const request = store.add(setData);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * 세션 종료 및 저장
   */
  async endSession() {
    if (!this.currentSession) return null;

    const session = {
      ...this.currentSession,
      endTime: Date.now(),
      duration: Date.now() - this.currentSession.startTime,
      averageFormScore: this._average(this.currentSession.formScores),
      exercisesPerformed: [...this.currentSession.exercisesPerformed]
    };

    // DB에 저장
    if (this.db) {
      await new Promise((resolve) => {
        const transaction = this.db.transaction(['sessions'], 'readwrite');
        const store = transaction.objectStore('sessions');
        const request = store.add(session);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      });
    }

    console.log('[Dashboard] 세션 종료:', session);
    this.currentSession = null;
    return session;
  }

  /**
   * 운동 기록 불러오기
   */
  async getWorkoutHistory(days = 30) {
    if (!this.db) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return new Promise((resolve) => {
      const transaction = this.db.transaction(['sets'], 'readonly');
      const store = transaction.objectStore('sets');
      const index = store.index('date');
      const range = IDBKeyRange.lowerBound(cutoffStr);
      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  /**
   * 특정 운동의 최대 중량 기록
   */
  async getPersonalRecords(exerciseId) {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db.transaction(['sets'], 'readonly');
      const store = transaction.objectStore('sets');
      const index = store.index('exercise');
      const request = index.getAll(exerciseId);

      request.onsuccess = () => {
        const sets = request.result || [];
        if (sets.length === 0) return resolve(null);

        const maxWeight = Math.max(...sets.map(s => s.weight || 0));
        const maxVolume = Math.max(...sets.map(s => s.volume || 0));
        const bestFormScore = Math.max(...sets.map(s => s.averageQuality || 0));

        resolve({
          exerciseId,
          maxWeight,
          maxVolume,
          bestFormScore,
          totalSets: sets.length,
          totalReps: sets.reduce((sum, s) => sum + (s.reps || 0), 0)
        });
      };

      request.onerror = () => resolve(null);
    });
  }

  /**
   * 대시보드 렌더링
   */
  async renderDashboard(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const history = await this.getWorkoutHistory(30);
    const stats = this._calculateStats(history);

    container.innerHTML = this._generateDashboardHTML(stats, history);
    this._renderCharts(stats, history);
  }

  /**
   * 통계 계산
   */
  _calculateStats(sets) {
    if (!sets || sets.length === 0) {
      return {
        totalSessions: 0,
        totalVolume: 0,
        totalReps: 0,
        avgFormScore: 0,
        exerciseBreakdown: {},
        weeklyVolume: [],
        streakDays: 0
      };
    }

    // 날짜별 그룹화
    const byDate = {};
    sets.forEach(set => {
      const date = set.date || new Date(set.timestamp).toISOString().split('T')[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(set);
    });

    // 운동별 볼륨
    const exerciseBreakdown = {};
    sets.forEach(set => {
      if (!exerciseBreakdown[set.exercise]) {
        exerciseBreakdown[set.exercise] = { volume: 0, reps: 0, sets: 0 };
      }
      exerciseBreakdown[set.exercise].volume += set.volume || 0;
      exerciseBreakdown[set.exercise].reps += set.reps || 0;
      exerciseBreakdown[set.exercise].sets += 1;
    });

    // 주간 볼륨
    const weeklyVolume = this._calculateWeeklyVolume(sets);

    // 연속 운동 일수
    const streakDays = this._calculateStreak(Object.keys(byDate));

    return {
      totalSessions: Object.keys(byDate).length,
      totalVolume: sets.reduce((sum, s) => sum + (s.volume || 0), 0),
      totalReps: sets.reduce((sum, s) => sum + (s.reps || 0), 0),
      avgFormScore: Math.round(this._average(sets.map(s => s.averageQuality || 0).filter(s => s > 0))),
      exerciseBreakdown,
      weeklyVolume,
      streakDays,
      recentSets: sets.slice(-20).reverse()
    };
  }

  /**
   * 주간 볼륨 계산
   */
  _calculateWeeklyVolume(sets) {
    const weeks = {};
    sets.forEach(set => {
      const date = new Date(set.timestamp);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeks[weekKey]) weeks[weekKey] = 0;
      weeks[weekKey] += set.volume || 0;
    });

    return Object.entries(weeks)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([week, volume]) => ({ week, volume }));
  }

  /**
   * 연속 운동 일수 계산
   */
  _calculateStreak(dates) {
    if (dates.length === 0) return 0;

    const sortedDates = dates.sort().reverse();
    let streak = 0;
    let currentDate = new Date();

    for (const dateStr of sortedDates) {
      const date = new Date(dateStr);
      const diffDays = Math.floor((currentDate - date) / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        streak++;
        currentDate = date;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * 대시보드 HTML 생성
   */
  _generateDashboardHTML(stats, history) {
    const exerciseNames = {
      squat: '스쿼트', deadlift: '데드리프트', bench_press: '벤치프레스',
      push_up: '푸시업', overhead_press: 'OHP', plank: '플랭크',
      pull_up: '풀업', romanian_deadlift: 'RDL', dumbbell_row: '덤벨 로우',
      burpee: '버피'
    };

    const topExercises = Object.entries(stats.exerciseBreakdown)
      .sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, 5);

    return `
      <div class="dashboard-grid">
        <!-- 요약 카드들 -->
        <div class="stat-cards">
          <div class="stat-card">
            <div class="stat-icon">🏋️</div>
            <div class="stat-value">${stats.totalSessions}</div>
            <div class="stat-label">총 운동 횟수</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-value">${(stats.totalVolume / 1000).toFixed(1)}t</div>
            <div class="stat-label">총 볼륨</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">🔄</div>
            <div class="stat-value">${stats.totalReps.toLocaleString()}</div>
            <div class="stat-label">총 반복 횟수</div>
          </div>
          <div class="stat-card highlight">
            <div class="stat-icon">⭐</div>
            <div class="stat-value">${stats.avgFormScore}</div>
            <div class="stat-label">평균 자세 점수</div>
          </div>
          <div class="stat-card streak">
            <div class="stat-icon">🔥</div>
            <div class="stat-value">${stats.streakDays}일</div>
            <div class="stat-label">연속 운동</div>
          </div>
        </div>

        <!-- 차트 섹션 -->
        <div class="chart-section">
          <h3>주간 볼륨 추이</h3>
          <canvas id="weeklyVolumeChart" height="200"></canvas>
        </div>

        <!-- 운동 분포 -->
        <div class="exercise-breakdown">
          <h3>운동별 볼륨 (TOP 5)</h3>
          ${topExercises.map(([ex, data]) => `
            <div class="exercise-bar">
              <div class="exercise-bar-label">${exerciseNames[ex] || ex}</div>
              <div class="exercise-bar-track">
                <div class="exercise-bar-fill" style="width: ${Math.min(100, data.volume / Math.max(...topExercises.map(e => e[1].volume)) * 100)}%"></div>
              </div>
              <div class="exercise-bar-value">${data.volume}kg</div>
            </div>
          `).join('')}
          ${topExercises.length === 0 ? '<p class="no-data">아직 운동 기록이 없습니다</p>' : ''}
        </div>

        <!-- 최근 기록 -->
        <div class="recent-history">
          <h3>최근 운동 기록</h3>
          <div class="history-list">
            ${(stats.recentSets || []).slice(0, 8).map(set => `
              <div class="history-item">
                <span class="history-exercise">${exerciseNames[set.exercise] || set.exercise || '운동'}</span>
                <span class="history-detail">${set.reps}회 × ${set.weight ? set.weight + 'kg' : '체중'}</span>
                <span class="history-score" style="color: ${set.averageQuality >= 80 ? '#00ff88' : set.averageQuality >= 60 ? '#ffd700' : '#ff4444'}">
                  ${set.averageQuality || 0}점
                </span>
              </div>
            `).join('')}
            ${(!stats.recentSets || stats.recentSets.length === 0) ? '<p class="no-data">기록이 없습니다. 운동을 시작해보세요!</p>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 차트 렌더링 (Canvas API 사용)
   */
  _renderCharts(stats, history) {
    const canvas = document.getElementById('weeklyVolumeChart');
    if (!canvas || !stats.weeklyVolume || stats.weeklyVolume.length === 0) return;

    const ctx = canvas.getContext('2d');
    const { weeklyVolume } = stats;

    const maxVolume = Math.max(...weeklyVolume.map(w => w.volume), 1);
    const w = canvas.offsetWidth || 400;
    const h = 200;
    canvas.width = w;
    canvas.height = h;

    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const barWidth = chartW / weeklyVolume.length * 0.6;
    const barGap = chartW / weeklyVolume.length;

    // 배경
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, h);

    // 그리드 라인
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      // Y축 레이블
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText(Math.round(maxVolume * (1 - i / 4)) + 'kg', 5, y + 4);
    }

    // 막대 그래프
    weeklyVolume.forEach((week, i) => {
      const barH = (week.volume / maxVolume) * chartH;
      const x = padding.left + i * barGap + (barGap - barWidth) / 2;
      const y = padding.top + chartH - barH;

      // 그라디언트
      const gradient = ctx.createLinearGradient(x, y, x, y + barH);
      gradient.addColorStop(0, '#00f5ff');
      gradient.addColorStop(1, '#0055aa');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 4);
      ctx.fill();

      // X축 레이블
      const label = week.week.slice(5);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText(label, x + barWidth / 2 - 15, h - 8);
    });
  }

  _average(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}

window.Dashboard = Dashboard;
