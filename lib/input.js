const Promise = require('bluebird');
const config = require('./config.js');
const algo = require('./algorithms.js');
const async = require('async');
const Key = require('./key');

let client;

const updateSequence = function(userId, itemId, options = {}){
  return new Promise((resolve, reject) => {
    algo.updateSimilarityFor(userId, function(){
      algo.updateRecommendationsFor(userId, function(){
        resolve();
      });
    });
  });
};

const changeRating = function(userId, itemId, options){
  let updateRecommendations = true;
  if ('updateRecs' in options) {
    updateRecommendations = options.updateRecs ? true : false;
  }

  const removeRating = options.removeRating ? true : false;

  const feelingItemSet = options.liked ? Key.itemLikedBySet(itemId) : Key.itemDislikedBySet(itemId);
  const feelingUserSet = options.liked ? Key.userLikedSet(userId) : Key.userDislikedSet(userId);
  const mostFeelingSet = options.liked ? Key.mostLiked() : Key.mostDisliked();
  const passedUserSet = Key.userPassedSet(userId);

  return new Promise((resolve, reject) => {
    Promise.resolve().then(() => {
      return client.sismember(passedUserSet, itemId);
    }).then(result => {
      if (result === 1) {
        return client.srem(passedUserSet, itemId);
      }
      return;
    }).then(() => {
      // check if the rating is already stored
      return client.sismember(feelingItemSet, userId);
    }).then((result) => {
      // only increment the most feeling set if it doesn't already exist
      // if (result === 0 && !removeRating) {
      //   client.zincrby(mostFeelingSet, 1, itemId);
      // } else if (result > 0 && removeRating) {
      //   client.zincrby(mostFeelingSet, -1, itemId);
      // }
      return removeRating ? client.srem(feelingUserSet, itemId) :
        client.sadd(feelingUserSet, itemId);
    }).then(() => {
      return removeRating ? client.srem(feelingItemSet, userId) :
        client.sadd(feelingItemSet, userId);
    }).then(() => {
      return client.sismember(feelingItemSet, userId);
    }).then((result) => {
      // only fire update sequence if requested by the user
      // and there are results to compare
      if (updateRecommendations && result > 0) {
        updateSequence(userId, itemId).then(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
};

const addPassedItem = function(userId, itemId) {
  const passedUserSet = Key.userPassedSet(userId);

  return new Promise((resolve, reject) => {
    Promise.resolve().then(() => {
      return client.sadd(passedUserSet, itemId);
    }).then(() => {
      algo.updateRecommendationsFor(userId, err => {
        if (err) {
          console.log('error', err);
        }
        resolve();
      });
    });
  });
};

const liked = function(userId, itemId, options = {}){
  options.liked = true;
  return changeRating(userId, itemId, options).then(() => {
    if (options.hasOwnProperty('likes') && options.hasOwnProperty('dislikes') && options.date) {
      return updateActiveSet(itemId, options.likes, options.dislikes, options.date);
    }
  });
};

const disliked = function(userId, itemId, options = {}){
  options.liked = false;
  return changeRating(userId, itemId, options).then(() => {
    if (options.hasOwnProperty('likes') && options.hasOwnProperty('dislikes') && options.date) {
      return updateActiveSet(itemId, options.likes, options.dislikes, options.date);
    }
  });
};

const unliked = function(userId, itemId, options = {}){
  options.liked = true;
  options.removeRating = true;
  return changeRating(userId, itemId, options);
};

const undisliked = function(userId, itemId, options = {}){
  options.liked = false;
  options.removeRating = true;
  return changeRating(userId, itemId, options);
};

const passed = function(userId, itemId){
  return addPassedItem(userId, itemId);
};

const activated = function(itemId, date) {
  return client.zadd(Key.activeItemsZSet(), getHotness(0, 0, date), itemId);
}

const deactivated = function(itemId) {
  const pipeline = client.pipeline();
  pipeline.zrem(Key.activeItemsZSet(), itemId);
  pipeline.del(Key.itemLikedBySet(itemId));
  pipeline.del(Key.itemDislikedBySet(itemId));
  return pipeline.exec().then(() => {
    console.log(`deactivated promise resolved for ${itemId}`);
  });
}

const updateActiveSet = function(itemId, likes, dislikes, date) {
  return client.zadd(Key.activeItemsZSet(), getHotness(likes, dislikes, date), itemId).then(() => {
    console.log(`updateActiveSet promise resolved for ${itemId}`);
  });
}

const getHotness = function(likes, dislikes, date) {
  const REDDIT_BD_TIMESTAMP = 1134028003;
  const score = likes*2 - dislikes*2;
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = Math.sign(score);
  const timestamp = new Date(date).getTime() / 1000;
  const seconds = timestamp - REDDIT_BD_TIMESTAMP;
  return sign * order + seconds / 45000;
}

const setUsersEligibleForViewDebt = function(users) {
  return client.sadd(Key.usersForViewDebtSet(), ...users);
}

const setClient = function(inClient) {
  client = inClient;
};

const input = {
  liked,
  disliked,
  unliked,
  undisliked,
  passed,
  activated,
  deactivated,
  updateSequence,
  setUsersEligibleForViewDebt,
  setClient
};

module.exports = input;
