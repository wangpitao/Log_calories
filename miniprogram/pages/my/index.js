const app = getApp();

Page({
  data: {
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    defaultAvatar: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
    totalDays: 0,
    totalRecords: 0
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    }
  },

  onShow() {
    this.fetchStats();
  },

  async fetchStats() {
    try {
      await app.cloudInitPromise;
      const res = await app.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'getProfileStats' }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.errMsg) || '获取统计失败');
      }

      const stats = res.result.data || {};
      
      this.setData({
        totalRecords: stats.totalRecords || 0,
        totalDays: stats.totalDays || 0
      }); 
    } catch (e) {
      console.log('获取统计数据失败', e);
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    const userInfo = { ...this.data.userInfo, avatarUrl };
    this.setData({ userInfo });
    wx.setStorageSync('userInfo', userInfo);
  },

  onInputNickname(e) {
    const nickName = e.detail.value;
    const userInfo = { ...this.data.userInfo, nickName };
    this.setData({ userInfo });
    wx.setStorageSync('userInfo', userInfo);
  },

  goTarget() {
    wx.navigateTo({ url: '/pages/target/index' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  }
});
