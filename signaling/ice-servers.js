/**
 * Fetches ICE server configuration (STUN + TURN) from AWS Kinesis Video Streams.
 * Caches credentials for 4 minutes (KVS TURN credentials are valid for ~5 min).
 * Falls back to Google public STUN servers if KVS is not configured or fails.
 */
const {
  KinesisVideoClient,
  DescribeSignalingChannelCommand,
  GetSignalingChannelEndpointCommand
} = require('@aws-sdk/client-kinesis-video');
const {
  KinesisVideoSignalingClient,
  GetIceServerConfigCommand
} = require('@aws-sdk/client-kinesis-video-signaling');

const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const CACHE_TTL_MS = 4 * 60 * 1000; // 4 minutes

let cached = null;
let cachedAt = 0;
/** @type {Promise<Array> | null} — deduplicates concurrent fetches */
let inflight = null;

/**
 * @returns {Promise<Array<{urls: string|string[], username?: string, credential?: string}>>}
 */
async function getIceServers() {
  const region = process.env.AWS_REGION;
  const channelName = process.env.KVS_CHANNEL_NAME;

  if (!region || !channelName) {
    return FALLBACK_ICE_SERVERS;
  }

  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
  try {
    const kvsClient = new KinesisVideoClient({ region });

    // 1. Get channel ARN
    const describeRes = await kvsClient.send(
      new DescribeSignalingChannelCommand({ ChannelName: channelName })
    );
    const channelARN = describeRes.ChannelInfo.ChannelARN;

    // 2. Get HTTPS endpoint for the signaling channel
    const endpointRes = await kvsClient.send(
      new GetSignalingChannelEndpointCommand({
        ChannelARN: channelARN,
        SingleMasterChannelEndpointConfiguration: {
          Protocols: ['HTTPS'],
          Role: 'MASTER'
        }
      })
    );
    const httpsEndpoint = endpointRes.ResourceEndpointList.find(
      (e) => e.Protocol === 'HTTPS'
    )?.ResourceEndpoint;

    if (!httpsEndpoint) {
      throw new Error('No HTTPS endpoint returned from KVS');
    }

    // 3. Fetch ICE server config (TURN credentials)
    const signalingClient = new KinesisVideoSignalingClient({
      region,
      endpoint: httpsEndpoint
    });
    const iceRes = await signalingClient.send(
      new GetIceServerConfigCommand({ ChannelARN: channelARN })
    );

    // 4. Build ICE servers array
    const iceServers = [
      { urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` }
    ];

    for (const server of iceRes.IceServerList || []) {
      iceServers.push({
        urls: server.Uris,
        username: server.Username,
        credential: server.Password
      });
    }

    cached = iceServers;
    cachedAt = Date.now();
    console.log(`[ice-servers] Fetched ${iceServers.length} ICE servers from KVS`);
    return iceServers;
  } catch (err) {
    console.error('[ice-servers] KVS fetch failed, using fallback STUN:', err.message);
    return FALLBACK_ICE_SERVERS;
  } finally {
    inflight = null;
  }
  })();

  return inflight;
}

module.exports = { getIceServers };
