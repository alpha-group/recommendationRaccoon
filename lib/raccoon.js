const Redis = require('ioredis');
Redis.Promise = require('bluebird');

const config = require('./config.js');
const algo = require('./algorithms.js');
const input = require('./input.js');
const stat = require('./stat.js');

const client = new Redis({
  port: config.redisPort || 6379,
  host: config.redisUrl || '127.0.0.1',
  password: config.redisAuth || '',
  db: config.redisDb || 3
});

class Raccoon {}

algo.setClient(client);
input.setClient(client);
stat.setClient(client);

const inputProtoMethods = {
  liked,
  disliked,
  unliked,
  undisliked,
  passed,
  activated,
  deactivated,
  updateSequence,
  setUsersEligibleForViewDebt
} = input;

const statProtoMethods = {
  recommendFor,
  bestRated,
  worstRated,
  bestRatedWithScores,
  mostLiked,
  mostDisliked,
  usersWhoLikedAlsoLiked,
  mostSimilarUsers,
  leastSimilarUsers,
  likedBy,
  likedCount,
  dislikedBy,
  dislikedCount,
  allLikedFor,
  allDislikedFor,
  allWatchedFor,
  activeItemRankAndCount
} = stat;

const recProtoMethods = {
  predictFor: algo.predictFor
} = algo;

Raccoon.prototype = Object.assign(Raccoon.prototype, {config, stat},
  inputProtoMethods, statProtoMethods, recProtoMethods);

module.exports = exports = new Raccoon();
