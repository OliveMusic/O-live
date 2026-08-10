const {defineConfig,devices}=require('playwright/test');

const useSystemChrome=process.env.PLAYWRIGHT_USE_SYSTEM_CHROME==='1';
const externalBaseUrl=process.env.PLAYWRIGHT_TEST_BASE_URL||'';

module.exports=defineConfig({
  testDir:'./tests/e2e',
  fullyParallel:false,
  timeout:20000,
  expect:{timeout:6000},
  workers:process.env.CI ? 1 : undefined,
  reporter:process.env.CI
    ? [['line'],['html',{open:'never'}]]
    : 'line',
  use:{
    baseURL:externalBaseUrl||'http://127.0.0.1:4173',
    reducedMotion:'reduce',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
  },
  webServer:externalBaseUrl ? undefined : {
    command:'python3 -m http.server 4173 --bind 127.0.0.1',
    url:'http://127.0.0.1:4173/',
    reuseExistingServer:!process.env.CI,
    timeout:15000,
  },
  projects:[
    {
      name:'mobile-chromium',
      use:{
        ...devices['iPhone 15'],
        browserName:'chromium',
        ...(useSystemChrome ? {channel:'chrome'} : {}),
      },
    },
    {
      name:'mobile-webkit',
      use:{...devices['iPhone 15'],browserName:'webkit'},
    },
  ],
});
