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
  if (queryName.startsWith(queryDefinition.name)) {
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
  function recursiveAddNode(a, result, state) {
    for (let k in a) {
      if (k == 'id') {
        result[a[k]] = state[a[k]];
      } else if (typeof a[k] === 'object' && a[k]) {
        let m = a[k].id
        result[m] = state[m];
        recursiveAddNode(state[m], result, state)
      }
    }
  }
  for (const key in apolloProvider.clients) {
    const client = apolloProvider.clients[key]
    const state = client.cache.extract()
    let result = {}
    if (prefetchID in prefetchIDs) {
      result['ROOT_QUERY'] = state['ROOT_QUERY'];
      for (let i in state['ROOT_QUERY']) {
        for (let j of prefetchIDs[prefetchID].value) {
          if (checkIsSameQuery(i, j)) {
              recursiveAddNode(state['ROOT_QUERY'][i], result, state)
          }
        }
      }
      states[`${finalOptions.exportNamespace}${key}`] = result;
    } else {
      states[`${finalOptions.exportNamespace}${key}`] = state
    }
  }
  delete prefetchID[prefetchID]
  return states
}