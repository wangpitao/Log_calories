const app = getApp();

Page({
  data: {
    days: [],
    summary: {
      totalCalories: 0,
      avgCalories: 0,
      totalRecords: 0,
      trackedDays: 0
    },
    goal: {
      calories: 1800,
      protein: 90,
      fat: 55,
      carbs: 220
    }
  },

  onShow() {
    this.fetchReport();
  },

  getDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  getDisplayDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  },

  buildDateRange(count) {
    const days = [];
    const today = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      days.push({
        date: this.getDateString(date),
        label: this.getDisplayDate(date),
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        records: 0,
        percent: 0
      });
    }

    return days;
  },

  async fetchReport() {
    try {
      await app.cloudInitPromise;
      const res = await app.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getReport',
          days: 7
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.errMsg) || '报表加载失败');
      }

      const report = res.result.data;

      this.setData({
        days: report.days || [],
        goal: report.goal || this.data.goal,
        summary: report.summary || this.data.summary
      });
    } catch (e) {
      console.error('获取历史报表失败', e);
      wx.showToast({ title: '报表加载失败', icon: 'none' });
    }
  }
});
