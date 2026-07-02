const app = getApp();

const DEFAULT_GOAL = {
  calories: '1800',
  protein: '90',
  fat: '55',
  carbs: '220'
};

Page({
  data: {
    goalId: '',
    goal: { ...DEFAULT_GOAL },
    saving: false
  },

  onLoad() {
    this.fetchGoal();
  },

  toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  },

  onGoalInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;

    this.setData({
      [`goal.${field}`]: e.detail.value
    });
  },

  async fetchGoal() {
    try {
      await app.cloudInitPromise;
      const res = await app.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'getUserSettings' }
      });
      const goal = res.result && res.result.success ? res.result.data : null;

      if (goal) {
        this.setData({
          goalId: goal._id,
          goal: {
            calories: String(goal.calories || DEFAULT_GOAL.calories),
            protein: String(goal.protein || DEFAULT_GOAL.protein),
            fat: String(goal.fat || DEFAULT_GOAL.fat),
            carbs: String(goal.carbs || DEFAULT_GOAL.carbs)
          }
        });
      }
    } catch (e) {
      console.error('获取目标失败', e);
    }
  },

  async saveGoal() {
    if (this.data.saving) return;

    const goal = {
      calories: this.toNumber(this.data.goal.calories),
      protein: this.toNumber(this.data.goal.protein),
      fat: this.toNumber(this.data.goal.fat),
      carbs: this.toNumber(this.data.goal.carbs)
    };

    if (!goal.calories) {
      wx.showToast({ title: '请填写每日热量目标', icon: 'none' });
      return;
    }

    this.setData({ saving: true });

    try {
      await app.cloudInitPromise;
      const res = await app.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'saveUserSettings',
          data: goal
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.errMsg) || '保存失败');
      }

      this.setData({ goalId: res.result.data && res.result.data._id || this.data.goalId });

      wx.showToast({ title: '目标已保存', icon: 'success' });
    } catch (e) {
      console.error('保存目标失败', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
