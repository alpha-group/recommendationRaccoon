const Promise = require('bluebird');
const async = require('async');
const config = require('./config.js');
const Key = require('./key');

let client;

// the jaccard coefficient outputs an objective measurement of the similarity between two objects. in this case, two users. the coefficient
// is the result of summing the two users likes/dislikes incommon then summing they're likes/dislikes that they disagree on. this sum is
// then divided by the number of items they both reviewed.
const jaccardCoefficient = function (userId1, userId2) {
  let similarity = 0;
  let ratedInCommon = 0;
  let finalJaccardScore = 0;

  const user1LikedSet = Key.userLikedSet(userId1);
  const user1DislikedSet = Key.userDislikedSet(userId1);
  const user2LikedSet = Key.userLikedSet(userId2);
  const user2DislikedSet = Key.userDislikedSet(userId2);

  const pipeline = client.pipeline();
  // Users both liked (agreed)
  pipeline.sinter(user1LikedSet, user2LikedSet);
  // Users both disliked (agreed)
  pipeline.sinter(user1DislikedSet, user2DislikedSet);
  // Users rated but disagreed
  pipeline.sinter(user1LikedSet, user2DislikedSet);
  // Users rated but disagreed
  pipeline.sinter(user1DislikedSet, user2LikedSet);

  return pipeline.exec().then(result => {
    const agreements = result[0][1].length + result[1][1].length;
    const disagreements = result[2][1].length + result[3][1].length;

    similarity = agreements - disagreements;
    ratedInCommon = agreements + disagreements;

    finalJaccardScore = similarity / ratedInCommon;

    if (finalJaccardScore === 1) {
      finalJaccardScore -= Math.random() * 0.0000000000001;
    } else if (finalJaccardScore === -1) {
      finalJaccardScore += Math.random() * 0.0000000000001;
    }

    return finalJaccardScore;
  }).catch(err => {
    console.log(`Error encountered in jaccardCoefficient: ${err}`);
    return 0.0;
  });
};

const flatten = function(arr) {
  const stack = [...arr];
  const res = [];
  while (stack.length) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      stack.push(...next);
    } else {
      res.push(next);
    }
  }
  return res.reverse();
};

// this function updates the similarity for one user versus all others. at scale this probably needs to be refactored to compare a user
// against clusters of users instead of against all. every comparison will be a value between -1 and 1 representing simliarity.
// -1 is exact opposite, 1 is exactly the same.
exports.updateSimilarityFor = function(userId, cb){
  // turning the userId into a string. depending on the db they might send an object, in which it won't compare properly when comparing
  // to other users
  userId = String(userId);
  // initializing variables
  let userRatedItemIds, itemLiked, itemDisliked, itemLikeDislikeKeys;
  // setting the redis key for the user's similarity set
  const similarityZSet = Key.similarityZSet(userId);
  // creating a combined set with the all of a users likes and dislikes
  client.sunion(Key.userLikedSet(userId), Key.userDislikedSet(userId), function(err, userRatedItemIds){
    // if they have rated anything
    if (userRatedItemIds.length > 0){
      // creating a list of redis keys to look up all of the likes and dislikes for a given set of items
      itemLikeDislikeKeys = userRatedItemIds.map(itemId => {
        // key for that item being liked
        itemLiked = Key.itemLikedBySet(itemId);
        // key for the item being disliked
        itemDisliked = Key.itemDislikedBySet(itemId);
        // returning an array of those keys
        return [itemLiked, itemDisliked];
      });
    }
    // flattening the array of all the likes/dislikes for the items a user rated
    itemLikeDislikeKeys = flatten(itemLikeDislikeKeys);
    // builds one set of all the users who liked and disliked the same items
    client.sunion(itemLikeDislikeKeys, function(err, otherUserIdsWhoRated){
      // running in async parallel, going through the array of user ids who also rated the same things
      async.each(otherUserIdsWhoRated,
        // running a function on each item in the list
        function(otherUserId, callback){
          // if there is only one other user or the other user is the same user
          if (otherUserIdsWhoRated.length === 1 || userId === otherUserId){
            // then call the callback and exciting the similarity check
            callback();
          }
          // if the userid is not the same as the user
          if (userId !== otherUserId){
            // calculate the jaccard coefficient for similarity. it will return a value between -1 and 1 showing the two users
            // similarity
            jaccardCoefficient(userId, otherUserId).then(result => {
              // with the returned similarity score, add it to a sorted set named above
              client.zadd(similarityZSet, result, otherUserId, function(err){
                // call the async callback function once finished to indicate that the process is finished
                callback();
              });
            });
          }
        },
        // once all the async comparisons have been made, call the final callback based to the original function
        function(err){
          client.expire(similarityZSet, 259200, function(err, _) {
            cb();
          });
        }
      );
    });
  });
};

exports.predictFor = function(userId, itemId){
  userId = String(userId);
  itemId = String(itemId);
  let finalSimilaritySum = 0.0;
  let prediction = 0.0;
  const similarityZSet = Key.similarityZSet(userId);
  const likedBySet = Key.itemLikedBySet(itemId);
  const dislikedBySet = Key.itemDislikedBySet(itemId);

  return new Promise((resolve, reject) => {
    exports.similaritySum(similarityZSet, likedBySet, function(result1){
      exports.similaritySum(similarityZSet, dislikedBySet, function(result2){
        finalSimilaritySum = result1 - result2;
        client.scard(likedBySet, function(err, likedByCount){
          client.scard(dislikedBySet, function(err, dislikedByCount){
            prediction = finalSimilaritySum / parseFloat(likedByCount + dislikedByCount);
            if (isFinite(prediction)){
              resolve(prediction);
            } else {
              resolve(0.0);
            }
          });
        });
      });
    });
  });
};

exports.similaritySum = function(simSet, compSet, cb){
  let similarSum = 0.0;
  const pipeline = client.pipeline();
  client.smembers(compSet, function(err, userIds){
    async.each(userIds,
      function(userId, callback){
        pipeline.zscore(simSet, userId);
        callback();
      },
      function(err){
        pipeline.exec().then(results => {
          results.forEach(result => {
            similarSum += (parseFloat(result[1]) || 0.0);
          });
        }).then(() => {
          cb(similarSum);
        });
      }
    );
  });
};

// after the similarity is updated for the user, the users recommendations are updated
// recommendations consist of a sorted set in Redis. the values of this set are
// names of the items and the score is what raccoon estimates that user would rate it
// the values are generally not going to be -1 or 1 exactly because there isn't 100%
// certainty.
exports.updateRecommendationsFor = function(userId, cb){
  // turning the user input into a string so it can be compared properly
  userId = String(userId);
  // creating two blank arrays
  let setsToUnion = [];
  let scoreMap = [];
  // initializing the redis keys for temp sets, the similarity set and the recommended set
  const tempAllLikedSet = Key.tempAllLikedSet(userId);
  const similarityZSet = Key.similarityZSet(userId);
  const recommendedZSet = Key.recommendedZSet(userId);

  const pipeline = client.pipeline();
  // returns an array of the users that are most similar within k nearest neighbors
  pipeline.zrevrange(similarityZSet, 0, config.nearestNeighbors - 1);

  // returns an array of the users that are least simimilar within k nearest neighbors
  pipeline.zrange(similarityZSet, 0, config.nearestNeighbors - 1);

  pipeline.exec().then(results => {
    const mostSimilarUserIds = results[0][1];
    const leastSimilarUserIds = results[1][1];

    // iterate through the user ids to create the redis keys for all those users likes
    mostSimilarUserIds.forEach(usrId => {
      setsToUnion.push(Key.userLikedSet(usrId));
    });
    // if you want to factor in the least similar least likes, you change this in config
    // left it off because it was recommending items that every disliked universally
    leastSimilarUserIds.forEach(usrId => {
      setsToUnion.push(Key.userDislikedSet(usrId));
    });
    // if there is at least one set in the array, continue
    if (setsToUnion.length > 0){
      setsToUnion.unshift(tempAllLikedSet);
      client.sunionstore(setsToUnion, function(err) {
        // using the new array of all the items that were liked by people similar, disliked by people opposite, and items that user passed upon, create a new set with all the
        // items that the current user hasn't already rated
        client.sdiff(tempAllLikedSet, Key.userLikedSet(userId), Key.userDislikedSet(userId), Key.userPassedSet(userId), function(err, notYetRatedItems){
          // with the array of items that user has not yet rated, iterate through all of them and predict what the current user would rate it
          async.each(notYetRatedItems,
            function(itemId, callback){
              exports.predictFor(userId, itemId).then((score) => {
                // push the score and item to the score map array.
                scoreMap.push([score, itemId]);
                callback();
              });
            },
            // using score map which is an array of what the current user would rate all the unrated items,
            // add them to that users sorted recommended set
            function(err){
              client.del(recommendedZSet, function(err){
                async.each(scoreMap,
                  function(scorePair, callback){
                    pipeline.zadd(recommendedZSet, scorePair[0], scorePair[1]);
                    callback();
                  },
                  // after all the additions have been made to the recommended set,
                  function(err){
                    pipeline.exec().then(() => {
                      return client.del(tempAllLikedSet);
                    }).then(() => {
                      return client.zcard(recommendedZSet);
                    }).then(length => {
                      return client.zremrangebyrank(recommendedZSet, 0, length-config.numOfRecsStore - 1);
                    }).then(() => {
                      cb();
                    }).catch(() => {
                      cb();
                    });
                  }
                );
              });
            }
          );
        });
      });
    } else {
      cb();
    }
  });
};

// the wilson score is a proxy for 'best rated'. it represents the best finding the best ratio of likes and also eliminating
// outliers. the wilson score is a value between 0 and 1.
exports.updateWilsonScore = function(itemId, callback){
  // creating the redis keys for scoreboard and to get the items liked and disliked sets
  const scoreboard = Key.scoreboardZSet();
  const likedBySet = Key.itemLikedBySet(itemId);
  const dislikedBySet = Key.itemDislikedBySet(itemId);
  // used for a confidence interval of 95%
  const z = 1.96;
  // initializing variables to calculate wilson score
  let n, pOS, score;

  const pipeline = client.pipeline();

  pipeline.scard(likedBySet);
  pipeline.scard(dislikedBySet);

  pipeline.exec().then(results => {
    const likedResults = results[0][1];
    const dislikedResults = results[1][1];

    // if the total count is greater than zero
    if ((likedResults + dislikedResults) > 0){
      // set n to the sum of the total ratings for the item
      n = likedResults + dislikedResults;
      // set pOS to the num of liked results divided by the number rated
      // pOS represents the proportion of successes or likes in this case
      pOS = likedResults / parseFloat(n);
      // try the following equation
      try {
        // calculating the wilson score
        // http://www.evanmiller.org/how-not-to-sort-by-average-rating.html
        score = (pOS + z*z/(2*n) - z*Math.sqrt((pOS*(1-pOS)+z*z/(4*n))/n))/(1+z*z/n);
      } catch (e) {
        // if an error occurs, set the score to 0.0 and console log the error message.
        console.log(e.name + ": " + e.message);
        score = 0.0;
      }
      // add that score to the overall scoreboard. if that item already exists, the score will be updated.
      client.zadd(scoreboard, score, itemId, function(err){
        // call the final callback sent to the initial function.
        callback();
      });
    }
  });
};

exports.setClient = function(inClient) {
  client = inClient;
};
