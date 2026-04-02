import * as admin from 'firebase-admin';
// Initialize Firebase Admin
admin.initializeApp();

export { attribute } from './functions/attribute';
export { compressUploadedImage } from './functions/compressUploadedImage';
export { createAdvertiserAccount } from './functions/createAdvertiserAccount';
export { createShortLink } from './functions/createShortLink';
export { getNextAdBatch } from './functions/getNextAdBatch';
export { handleDeeplink } from './functions/handleDeeplink';
export {
  createInvite,
  deleteInvite,
  listInvites,
  updateInvite,
} from './functions/inviteManagement';
export { savePlaylistFromExtension } from './functions/savePlaylistFromExtension';
export { deletePlaylistFromExtension } from './functions/deletePlaylistFromExtension';
export { sendSupportEmail } from './functions/sendSupportEmail';
export { setAdminClaims } from './functions/setAdminClaims';
export { setAdvertiserClaims } from './functions/setAdvertiserClaims';
export { trackAdImpression } from './functions/trackAdImpression';
export { refreshPlaylistMetadata } from './functions/refreshPlaylistMetadata';
export { analyzeSharedPlaylist } from './functions/analyzeSharedPlaylist';
export {
  onPlaylistCreated,
  onPlaylistDeleted,
  backfillPlaylistIdIndex,
  getPlaylistIdIndex,
} from './functions/syncPlaylistIdIndex';
