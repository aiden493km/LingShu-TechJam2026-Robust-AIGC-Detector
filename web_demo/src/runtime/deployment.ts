export type DeploymentMode = 'local' | 'online';

export function deploymentModeFromViteMode(viteMode: string): DeploymentMode {
  return viteMode === 'online' ? 'online' : 'local';
}

export const DEPLOYMENT_MODE = deploymentModeFromViteMode(import.meta.env.MODE);

export function modelDeliveryCopy(mode: DeploymentMode) {
  if (mode === 'online') {
    return {
      title: 'DOWNLOADING MODEL',
      detail: 'Downloading and verifying the frozen FP32 model in this browser.',
      progressLabel: 'FP32 model download progress',
    };
  }

  return {
    title: 'LOADING LOCAL MODEL',
    detail: 'Verifying and preparing the local FP32 session.',
    progressLabel: 'Local FP32 model loading progress',
  };
}
