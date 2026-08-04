import packageMetadata from '../package.json'

/** 软件版本唯一取自 package.json，页面和构建产物不得各自写死版本号。 */
export const APP_VERSION = packageMetadata.version
