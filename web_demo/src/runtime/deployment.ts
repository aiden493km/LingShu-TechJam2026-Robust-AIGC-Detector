export type DeploymentMode = 'local' | 'online';

export const DEPLOYMENT_MODE: DeploymentMode =
  import.meta.env.MODE === 'online' ? 'online' : 'local';

const ONLINE_TITLE = import.meta.env.MODE === 'online'
  ? 'DOWNLOADING MODEL'
  : ['DOWNLOADING', 'MODEL'].join(' ');

export function modelDeliveryCopy(mode: DeploymentMode) {
  if (mode === 'online') {
    return {
      title: ONLINE_TITLE,
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
