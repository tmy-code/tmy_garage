import type { CapacitorConfig } from '@capacitor/cli';

// The Android app (ADR 0006). The screens are bundled from `npm run build:android`; the server's address is typed on
// first launch, never written here.
const config: CapacitorConfig = {
  appId: 'com.tmycode.tmy_garage',
  appName: 'TMY Garage',
  webDir: 'dist/android',
  android: {
    // Only for testing in the emulator against the dev server over plain HTTP. Release builds never set it.
    allowMixedContent: process.env.CAP_ALLOW_HTTP === '1',
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#000000' },
  },
};

export default config;
