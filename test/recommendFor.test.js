/*jshint expr:true*/
var chai = require('chai');
var spies = require('chai-spies');
var assert = chai.assert;
var expect = chai.expect;

const Key = require('../lib/key');

// var blanket = require("blanket")({
//     // options are passed as an argument object to the require statement
//    "pattern": "../lib/"
//  });

chai.use(spies);

const stat = require('../lib/stat');


describe('should go through correct flow when user is eligible for debt view', () => {
  it('shoould resolve with value from zrevrange', () => {
    const client = {
      sismember: chai.spy.returns(Promise.resolve(true)),
      srem: chai.spy.returns(true),
      zcount: chai.spy.returns([1,2,3,4]),
      zrevrange: chai.spy.returns([3,4]),
    };

    Key.userForViewDebtSet = chai.spy.returns('userDebtKey');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');


    stat.setClient(client);


    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([3,4]);
    }).catch(err => console.log(err));
  });
});

describe('shoudl go through correct flow when user is not elgible for debt views', () => {
  it('should return empty value, if there are no values in active set and recommended set', () => {
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false)),
      multi: chai.spy.returns({
        zcard: chai.spy.returns({
          zcard: chai.spy.returns({
            exec: chai.spy.returns([]),
          }),
          
        })
      }),
    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([]);
    });
  });

  it('should return intersection of two sets if both are present', () => {
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false)),
      multi: chai.spy.returns({
        zcard: chai.spy.returns({
          zcard: chai.spy.returns({
            exec: chai.spy.returns([[[1,2,3], 3], [[3,4], 2]]),
          }),
          
        })
      }),
      zinterstore: chai.spy.returns(Promise.resolve([3])),
      zrevrange: chai.spy.returns([3]),
    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
    Key.userIntersectionZSet = chai.spy.returns('userInstersectionKey')
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([3]);
    });
  });
 

  it('should return recommended set if intersection is empty', () => {
    function spyZrevRange(key) {
      if (key === 'userInstersectionKey') {
        return [];
      }
      return [5,6,7];
    }
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false)),
      multi: chai.spy.returns({
        zcard: chai.spy.returns({
          zcard: chai.spy.returns({
            exec: chai.spy.returns([[[1,2,3], 3], [[3,4], 2]]),
          }),
        })
      }),
      zinterstore: chai.spy.returns(Promise.resolve([3])),
      zrevrange: spyZrevRange,
    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
    Key.userIntersectionZSet = chai.spy.returns('userInstersectionKey')
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([5,6,7]);
    });
  });

  it('should return recommended set if active items set is empty', () => {
    function spyZrevRange(key) {
      if (key === 'recommendedZSet') {
        return [7,8];
      }
    }
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false)),
      multi: chai.spy.returns({
        zcard: chai.spy.returns({
          zcard: chai.spy.returns({
            exec: chai.spy.returns([[[], 0], [[3,4], 2]]),
          }),
        })
      }),
      zinterstore: chai.spy.returns(Promise.resolve([3])),
      zrevrange: spyZrevRange,
    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
    Key.userIntersectionZSet = chai.spy.returns('userInstersectionKey')
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([7,8]);
    });
  });

  it('should return active set if recommended items set is empty', () => {
    function spyZrevRange(key) {
      if (key === 'activeItemsKey') {
        return [8, 9];
      }
    }
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false)),
      multi: chai.spy.returns({
        zcard: chai.spy.returns({
          zcard: chai.spy.returns({
            exec: chai.spy.returns([[[1,2,3], 3], [[], 0]]),
          }),
        })
      }),
      zinterstore: chai.spy.returns(Promise.resolve([3])),
      zrevrange: spyZrevRange,
    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
    Key.userIntersectionZSet = chai.spy.returns('userInstersectionKey')
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([8,9]);
    });
  });

  it('should return empty array if both sets are empty', () => {
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false)),
      multi: chai.spy.returns({
        zcard: chai.spy.returns({
          zcard: chai.spy.returns({
            exec: chai.spy.returns([[[], 0], [[], 0]]),
          }),
        })
      }),
      zinterstore: chai.spy.returns(Promise.resolve([3])),
      zrevrange: chai.spy.returns([1,2,3]),
    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
    Key.userIntersectionZSet = chai.spy.returns('userInstersectionKey')
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([]);
    });
  });
})

describe('should handle "real" error correctly' , () => {
  it('should resolve empty array if real error is thrown in code', () => {
    const client = {
      sismember: chai.spy.returns(Promise.resolve(false).then(() => {
        throw new Error('TEST ERROR')
      })),

    }
    Key.recommendedZSet = chai.spy.returns('recommendedZSet');
    Key.activeItemsZSet = chai.spy.returns('activeItemsKey');
    Key.userIntersectionZSet = chai.spy.returns('userInstersectionKey')
  
    stat.setClient(client);
  
  
    stat.recommendFor('userID', 1).then(result => {
      expect(result).to.deep.equal([]);
    });
  })
})