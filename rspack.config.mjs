import path from 'node:path';

export const variants = [
  { name: 'depend-on-lazy', scenario: 'depend-on', hashLoading: 'lazy' },
  { name: 'depend-on-eager', scenario: 'depend-on', hashLoading: 'eager' },
  { name: 'depend-on-lazy-with-async', scenario: 'depend-on', hashLoading: 'lazy', withAsync: true },
  { name: 'css-carrier-lazy', scenario: 'css-carrier', hashLoading: 'lazy', split: true },
  { name: 'css-carrier-eager', scenario: 'css-carrier', hashLoading: 'eager', split: true },
  { name: 'css-carrier-lazy-no-split', scenario: 'css-carrier', hashLoading: 'lazy', split: false },
];

export function makeConfig(rspack, root, variant) {
  const config = {
    mode: 'production',
    target: 'web',
    context: path.join(root, 'cases', variant.scenario === 'depend-on' ? '01-initial-entry-group' : '02-css-only-carrier'),
    entry: './main.js',
    cache: false,
    incremental: false,
    devtool: false,
    output: {
      path: path.join(root, 'dist', variant.name),
      filename: '[name].js',
      chunkFilename: '[name].js',
      cssChunkFilename: '[name].css',
      publicPath: 'auto',
      crossOriginLoading: 'anonymous',
      clean: true,
    },
    optimization: { minimize: false, concatenateModules: false, chunkIds: 'named', moduleIds: 'named' },
    plugins: [new rspack.SubresourceIntegrityPlugin({ enabled: true, hashLoading: variant.hashLoading, hashFuncNames: ['sha256'] })],
  };
  if (variant.scenario === 'depend-on') {
    config.entry = {
      shared: './shared.js',
      main: { import: variant.withAsync ? ['./main.js', './extra-entry.js'] : './main.js', dependOn: 'shared' },
    };
    config.optimization.runtimeChunk = 'single';
  } else {
    config.module = { rules: [{ test: /\.css$/, type: 'css' }] };
    config.optimization.splitChunks = variant.split ? {
      chunks: 'async',
      minSize: 0,
      cacheGroups: {
        extractedJs: { test: /[/\\]a\.js$/, name: 'a-code', enforce: true },
      },
    } : false;
  }
  return config;
}
