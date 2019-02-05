
const config = require('./config');
const Key = require('./key');

let client;

const stat = {
  viewDebtFlow: function (userId, numberOfRecs) {
    // If user is eligible remove them from view debt set
    return client.srem(Key.usersForViewDebtSet(), userId).then(() => {
      // Get count of items in active set
      return client.zcount(Key.activeItemsZSet(), '-inf', '+inf');
    }).then(activeCount => {
      // Skip half of hottest posts and return post from the rest
      const postsToSkip = Math.ceil(activeCount / 2);
      return client.zrevrange(Key.activeItemsZSet(), postsToSkip, postsToSkip + numberOfRecs);
    });
  },
  normalFlow: function (userId, numberOfRecs) {
    // Get count of user recommended set and active items set
    return client.multi()
      .zcard(Key.activeItemsZSet())
      .zcard(Key.recommendedZSet(userId))
      .exec().then(results => {
        // Getting list of active items and recommended items
        if (!results || !results.length) {
          // Both lists are empty, returning empty array
          return [];
        }
        const [activeItemsCount, recommendedItemCount] = results;
        switch (true) {
          case (activeItemsCount[1] > 0 && recommendedItemCount[1] > 0):
            // If both sets are not empty, create intersection set
            return client.zinterstore(
              Key.userIntersectionZSet(userId),
              2,
              Key.recommendedZSet(userId),
              Key.activeItemsZSet()).then(() => {
                // Get contents from intersection set
                return client.zrevrange(Key.userIntersectionZSet(userId), 0, numberOfRecs);
              }).then(results => {
                if (results && results.length) {
                  // Intersection is not empty, returning members of intersection
                  return results;
                }
                // If intersection is empty fall back to recommended set
                return client.zrevrange(Key.recommendedZSet(userId), 0, numberOfRecs);
              });
          case (recommendedItemCount[1] > 0):
            // Active items set is empty, but recommended set is not empty, returning items from recommended set
            return client.zrevrange(Key.recommendedZSet(userId), 0, numberOfRecs);
          case (activeItemsCount[1] > 0):
            // Recommended set is empty, but active set is not, calculating difference between active items set and user's liked, disliked and passed items
            return client.zunionstore(
              Key.userFilteredActiveItemsZSet(userId),
              4,
              Key.activeItemsZSet(userId),
              Key.userPassedSet(userId),
              Key.userLikedSet(userId),
              Key.userDislikedSet(userId),
              'WEIGHTS',
              1,
              0,
              0,
              0,
              'AGGREGATE',
              'MIN'
              ).then(() => {
                return client.zrevrangebyscore(Key.userFilteredActiveItemsZSet(userId), '+inf', 1).then(results => {
                  // Returning filtered active items
                  return results;
                });
              });
          default:
            // Both recommended and active sets are empty, returning empty array
            return [];
      });
  },
  recommendFor: function (userId, numberOfRecs) {
    console.log('##### Start of recommendation function for user', userId);
    // check if user is eligible for post with view debt
    return client.sismember(Key.usersForViewDebtSet(), userId).then(isEligibleForViewDebt => {
      console.log('##### Is user eligible for view debt', !!isEligibleForViewDebt);
      if (isEligibleForViewDebt) {
        return viewDebtFlow();
      }
      return normalFlow();
    }).catch(err => {
      console.log('recommendFor error', err);
      return [];
    });
  },
  bestRated: function(){
    return new Promise((resolve, reject) => {
      client.zrevrange(Key.scoreboardZSet(), 0, -1).then((results) => {
        resolve(results);
      });
    });
  },
  worstRated: function(){
    return new Promise((resolve, reject) => {
      client.zrange(Key.scoreboardZSet(), 0, -1).then((results) => {
        resolve(results);
      });
    });
  },
  bestRatedWithScores: function(numOfRatings){
    return new Promise((resolve, reject) => {
      client.zrevrange(Key.scoreboardZSet(), 0, numOfRatings, 'withscores').then((results) => {
        resolve(results);
      });
    });
  },
  mostLiked: function(){
    return new Promise((resolve, reject) => {
      client.zrevrange(Key.mostLiked(), 0, -1).then((results) => {
        resolve(results);
      });
    });
  },
  mostDisliked: function(){
    return new Promise((resolve, reject) => {
      client.zrevrange(Key.mostDisliked(), 0, -1).then((results) => {
        resolve(results);
      });
    });
  },
  usersWhoLikedAlsoLiked: function(itemId){
  },
  mostSimilarUsers: function(userId){
    return new Promise((resolve, reject) => {
      client.zrevrange(Key.similarityZSet(userId), 0, -1).then((results) => {
        resolve(results);
      });
    });
  },
  leastSimilarUsers: function(userId){
    return new Promise((resolve, reject) => {
      client.zrange(Key.similarityZSet(userId), 0, -1).then((results) => {
        resolve(results);
      });
    });
  },
  likedBy: function(itemId){
    return new Promise((resolve, reject) => {
      client.smembers(Key.itemLikedBySet(itemId)).then((results) => {
        resolve(results);
      });
    });
  },
  likedCount: function(itemId){
    return new Promise((resolve, reject) => {
      client.scard(Key.itemLikedBySet(itemId)).then((results) => {
        resolve(results);
      });
    });
  },
  dislikedBy: function(itemId){
    return new Promise((resolve, reject) => {
      client.smembers(Key.itemDislikedBySet(itemId)).then((results) => {
        resolve(results);
      });
    });
  },
  dislikedCount: function(itemId){
    return new Promise((resolve, reject) => {
      client.scard(Key.itemDislikedBySet(itemId)).then((results) => {
        resolve(results);
      });
    });
  },
  allLikedFor: function(userId){
    return new Promise((resolve, reject) => {
      client.smembers(Key.userLikedSet(userId)).then((results) => {
        resolve(results);
      });
    });
  },
  allDislikedFor: function(userId){
    return new Promise((resolve, reject) => {
      client.smembers(Key.userDislikedSet(userId)).then((results) => {
        resolve(results);
      });
    });
  },
  allWatchedFor: function(userId){
    return new Promise((resolve, reject) => {
      client.sunion(Key.userLikedSet(userId), Key.userDislikedSet(userId)).then((results) => {
        resolve(results);
      });
    });
  },
  activeItemRankAndCount: function(itemId) {
    return new Promise((resolve, reject) => {
      Promise.resolve().then(() => {
        return client.multi()
          .zrevrank(Key.activeItemsZSet(), itemId)
          .zcard(Key.activeItemsZSet())
          .exec();
      }).then(([rankData, countData]) => {
        return resolve({
          rank: rankData[1],
          count: countData[1],
        });
      });

    });
  },
  setClient: function(inClient) {
    client = inClient;
  },
};

module.exports = exports = stat;
