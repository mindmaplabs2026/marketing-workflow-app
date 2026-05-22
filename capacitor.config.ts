import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mindmaplabs.workflow',
  appName: 'Mindmap Workflow',
  webDir: 'public',
  server: {
    url: 'https://marketing-workflow-app-ht3l.vercel.app',
    androidScheme: 'https',
  },
};

export default config;
