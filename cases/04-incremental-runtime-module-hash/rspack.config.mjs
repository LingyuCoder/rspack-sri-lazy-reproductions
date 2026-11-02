import path from 'node:path';

export const variants = [
  { name: 'lazy-default-incremental', hashLoading: 'lazy', incremental: true, expectPanic: true },
  { name: 'lazy-full-chunk-hashes', hashLoading: 'lazy', incremental: { chunksHashes: false } },
  { name: 'eager-default-incremental', hashLoading: 'eager', incremental: true },
  { name: 'lazy-no-incremental', hashLoading: 'lazy', incremental: false },
];

export function makeConfig(rspack, context, outputPath, variant) {
  return {
    mode: 'development',
    context,
    target: 'web',
    entry: './index.js',
    devtool: false,
    cache: false,
    incremental: variant.incremental,
    output: {
      path: path.resolve(outputPath),
      filename: 'main.js',
      chunkFilename: '[name].js',
      publicPath: '/',
      crossOriginLoading: 'anonymous',
      clean: true,
    },
    optimization: { minimize: false, concatenateModules: false },
    plugins: [new rspack.SubresourceIntegrityPlugin({
      enabled: true,
      hashLoading: variant.hashLoading,
      hashFuncNames: ['sha256'],
    })],
  };
}
