module.exports = { testDir: './e2e', timeout: 60000, workers: 1, reporter: [['list'], ['json', { outputFile: 'test-results.json' }]], use: { viewport: { width: 1440, height: 900 } } };
