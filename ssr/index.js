let prefetchIDs = require('../dist/vue-apollo.umd.js').prefetchIDs;

exports.getStates = function (apolloProvider, options) {
  const finalOptions = Object.assign({}, {
    exportNamespace: '',
  }, options)
  const states = {}
  for (const key in apolloProvider.clients) {
    const client = apolloProvider.clients[key]
    const state = client.cache.extract()
    states[`${finalOptions.exportNamespace}${key}`] = state
  }
  return states
}

exports.exportStates = function (apolloProvider, options) {
  const finalOptions = Object.assign({}, {
    globalName: '__APOLLO_STATE__',
    attachTo: 'window',
  }, options)
  const states = exports.getStates(apolloProvider, finalOptions)
  const js = `${finalOptions.attachTo}.${finalOptions.globalName} = ${JSON.stringify(states)};`
  return js
}


function isEquivalent(a, b) {
	if (typeof a !== typeof b) {
  	return false;
  }
  if (typeof a !== 'object') {
  	return a == b;
  }
  if (!a && !b) {
  	return true;
  } else if (!a || !b) {
  	return false;
  }
  var aProps = Object.getOwnPropertyNames(a);
  var bProps = Object.getOwnPropertyNames(b);

  if (aProps.length != bProps.length) {
      return false;
  }
  for (var i = 0; i < aProps.length; i++) {
      var propName = aProps[i];
      if (!(propName in b)) {
      	return false;
      }
      if (!isEquivalent(a[propName], b[propName])) {
          return false;
      }
  }

  return true;
}

checkIsSameQuery = function (queryName, queryDefinition) {
  let k = queryName.indexOf('(');
  if (k === -1) {
    return false;
  }
  if (queryName.slice(0, k) === queryDefinition.name) {
    let variableByQueryName = queryName.slice(queryDefinition.name.length + 1);
    variableByQueryName = variableByQueryName.slice(0, variableByQueryName.length - 1);
    if (isEquivalent(queryDefinition.variables, JSON.parse(variableByQueryName || '{}'))) {
      return true;
    }
  } else {
    return false
  }
}

exports.getStatesK = function (prefetchID, apolloProvider, options) {
  const finalOptions = Object.assign({}, {
    exportNamespace: '',
  }, options)
  const states = {}
  let addedIds = new Set();
  function recursiveAddNode(a, result, state) {
    for (let k in a) {
      if (k == 'id') {
        result[a[k]] = state[a[k]];
        //TODO check if rootquery alwasy have such plain object
        if (!addedIds.has(a[k])) {
          addedIds.add(a[k]);
          recursiveAddNode(state[a[k]], result, state)
        }
      } else if (typeof a[k] === 'object' && a[k]) {
        if (a[k].length !== undefined) {
          for (let n of a[k]) {
            recursiveAddNode(n, result, state)
          }
        } else {
          recursiveAddNode(a[k], result, state)
        }
      }
    }
  }
  for (const key in apolloProvider.clients) {
    const client = apolloProvider.clients[key]
    const state = client.cache.extract()
    let result = {}
    if (prefetchID in prefetchIDs) {
      let root_query = {};
      // result['ROOT_QUERY'] = state['ROOT_QUERY'];
      for (let i in state['ROOT_QUERY']) {
        for (let j of prefetchIDs[prefetchID].value) {
          if (checkIsSameQuery(i, j)) {
            root_query[i] = state['ROOT_QUERY'][i]
            recursiveAddNode(state['ROOT_QUERY'][i], result, state)
          }
        }
      }
      result['ROOT_QUERY'] = root_query;
      states[`${finalOptions.exportNamespace}${key}`] = result;
    } else {
      states[`${finalOptions.exportNamespace}${key}`] = state
    }
  }
  delete prefetchID[prefetchID]
  return states
}