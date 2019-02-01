class Config {
  constructor(args) {
    this.nearestNeighbors = process.env.RACCOON_NEAREST_NEIGHBORS || 5;
    this.className = process.env.RACCOON_CLASS_NAME || 'post';
    this.numOfRecsStore = process.env.RACCOON_NUMBER_OF_RECORDS || 30;
    this.factorLeastSimilarLeastLiked = process.env.RACCOON_FACTOR_LEAST_SIMILAR_LEAST_LIKED || false;
    this.redisUrl = process.env.RACCOON_REDIS_URL || '127.0.0.1';
    this.redisPort = process.env.RACCOON_REDIS_PORT || 6379;
    this.redisAuth = process.env.RACCOON_REDIS_AUTH || '';
    this.redisDb = process.env.RACCOON_REDIS_DB || 3;
  }
}

module.exports = new Config();
