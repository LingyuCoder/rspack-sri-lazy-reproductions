import path from 'node:path';

export function makeConfig(rspack, context, outputPath, { hashLoading = 'lazy', incremental } = {}) {
  return {
    mode: 'development',
    context,
    target: 'web',
    entry: './index.js',
    devtool: false,
    cache: false,
    incremental: incremental ?? {
      chunksRuntimeRequirements: true,
      chunksHashes: false,
      chunkAsset: false,
    },
    output: {
      path: path.resolve(outputPath),
      filename: 'main.js',
      chunkFilename: '[name].js',
      publicPath: 'auto',
      crossOriginLoading: 'anonymous',
      clean: true,
    },
    optimization: { minimize: false, concatenateModules: false },
    plugins: [new rspack.SubresourceIntegrityPlugin({
      enabled: true,
      hashFuncNames: ['sha256'],
      hashLoading,
    })],
  };
}
