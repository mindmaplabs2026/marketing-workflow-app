import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mindmaplabs.workflow',
  appName: 'Mindmap Workflow',
  webDir: 'public',
  server: {
    url: 'https://marketing-workflow-app-ht3l.vercel.app',
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#18181b',
      overlaysWebView: false,
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#18181b',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
};

export default config;
