import CopyWebpackPlugin from 'copy-webpack-plugin';
import type { Configuration } from 'webpack';
import { mergeWithRules } from 'webpack-merge';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config.ts';

// Grafana 12.0.x does not expose `react/jsx-runtime` to plugins, so the JSX runtime
// helpers are bundled instead of being loaded from Grafana.
const bundledJsxRuntime = ['react/jsx-runtime', 'react/jsx-dev-runtime'];

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return mergeWithRules({
    module: {
      rules: {
        test: 'match',
        use: 'merge',
      },
    },
  })(
    {
      ...baseConfig,
      externals: (baseConfig.externals as unknown[]).filter((item) => !bundledJsxRuntime.includes(item as string)),
    } as Configuration,
    {
      module: {
        rules: [
          {
            test: /\.[tj]sx?$/,
            use: {
              loader: 'swc-loader',
              options: {
                jsc: {
                  transform: {
                    react: {
                      runtime: 'automatic',
                    },
                  },
                },
              },
            },
          },
        ],
      },
      plugins: [
        new CopyWebpackPlugin({
          patterns: [{ from: '../NOTICE', to: '.' }],
        }),
      ],
    }
  );
};

export default config;
