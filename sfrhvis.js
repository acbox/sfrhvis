var config = require('config');
var AWS = require('aws-sdk');

var express = require('express');
var app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'))

var _ = require('lodash');

var historyEnd;
var historyStart;

var instanceIdGroupMappings = {};

var setupInstanceIdGroupMappings = function(data) {
  var unique_instance_ids = _.uniq(_.map(data.HistoryRecords, function(x) {
    return x.EventInformation.InstanceId
  }));
  instanceIdGroupMappings = _.reduce(unique_instance_ids, function(hash, instance_id, i) {
    hash[instance_id] = i
    return hash
  }, {});
};

var getVisGroups = function() {
  return _.map(instanceIdGroupMappings, function (group_id, instance_id) {
    return {
      id: group_id,
      content: instance_id,
    };
  });
};

var getVisItems = function(data) {
  var items = [];
  var itemId = 0;

  // shallow copy the original data - we're going to modify it
  var historyRecords = _.map(data.HistoryRecords, function(x) {
    return {
      eventSubType: x.EventInformation.EventSubType,
      instanceId: x.EventInformation.InstanceId,
      timestamp: x.Timestamp
    }
  });

  // strip out termination_notified and any other event type
  for (var k = 0; k < historyRecords.length; k++) {
    if (!(historyRecords[k].eventSubType.match(/^(?:launched|stopped|terminated)$/))) {
      historyRecords.splice(k, 1);
    }
  }

  while (historyRecords.length > 0) {
    var recordB = {};
    var startDate = {};
    var endDate = {};
    var className = '';

    // get the first record
    var recordA = historyRecords.shift();

    if (recordA.eventSubType == 'launched') {
      startDate = new Date(recordA.timestamp);

      // search for the corresponding stop record for
      for (var j = 0; j < historyRecords.length; j++) {
        if (historyRecords[j].instanceId == recordA.instanceId) {
          recordB = (historyRecords.splice(j, 1))[0];
          break;
        }
      }

      if (_.isEmpty(recordB)) {
        className = 'running'
      } else {
        className = (recordB.eventSubType === "stopped") ? 'stopped' : 'terminated';
      }
      endDate = _.isEmpty(recordB) ? historyEnd : new Date(recordB.timestamp);
    } else {
      // recordA is a stopped/terminated event, set start to beginning of period
      className = (recordA.eventSubType === "stopped") ? 'stopped' : 'terminated';
      startDate = historyStart;
      endDate = new Date(recordA.timestamp);
    }

    console.log('Creating item start/end item with the following properties:');
    console.log(recordA);
    console.log(recordB);

    items.push({
      id: itemId,
      group: instanceIdGroupMappings[recordA.instanceId],
      start: startDate.toString(),
      end: endDate.toString(),
      className: className,
    });
    
    itemId += 1;
  }

  return items;
};

app.get('/', function(req, res) {
    console.log(JSON.stringify(req.query));

    var region = req.query.region || config.region
    var requestId = req.query.requestId || config.requestId;
    var startTimeOffset = req.query.startTimeOffset || config.startTimeOffset;

    AWS.config.update({region: region});

    historyEnd = new Date();
    historyStart = new Date(historyEnd);
    var startTimeString = historyStart.toString();

    //if ('startTime' in req.query && typeof req.query.startTime !== 'undefined') {
    if (typeof startTimeOffset !== undefined) {
      historyStart.setMinutes(historyEnd.getMinutes() - 60 * startTimeOffset);
      startTimeString = historyStart.toString() + ' (' + startTimeOffset + ' hours ago)';
    } else {
      historyStart.setHours(0,0,0,0);
    }

    var params = {
      SpotFleetRequestId: requestId,
      StartTime: historyStart,
      DryRun: false,
      EventType: 'instanceChange',
      MaxResults: 0,
    };
    
    var ec2 = new AWS.EC2();
    ec2.describeSpotFleetRequestHistory(params, function(err, data) {
      if (err) {
        console.log(err, err.stack); // an error occurred
        res.render('error', {
            error: err
        });
      }
      else {
        console.log('Successful AWS SDK response:');
        console.log(data);

        setupInstanceIdGroupMappings(data);
        
        var groups = getVisGroups(data);
        console.log('Extracted instance IDs as vis.js groups:');
        console.log(JSON.stringify(groups));
        
        var items = getVisItems(data);
        console.log('Extracted the following instanceChange events as vis.js items:');
        console.log(JSON.stringify(items));

        var changeEvents = items.length;

        res.render('index', {
            groups: groups,
            items: items,
            requestId: requestId,
            startTime: startTimeString,
            changeEvents: changeEvents,
        });
      }
    });
});

app.listen(config.listenPort);
console.log('Listening on port ' + config.listenPort);

/*
   getVisItems() turns this:

      {
          "EventInformation": {
              "EventDescription": "{\"instanceType\":\"r3.xlarge\",\"image\":\"ami-785db401\",\"productDescription\":\"Linux/UNIX (Amazon VPC)\",\"availabilityZone\":\"eu-west-1a\"}",
              "EventSubType": "launched",
              "InstanceId": "i-0a3c92eba39f1c0d2"
          },
          "EventType": "instanceChange",
          "Timestamp": "2017-11-28T09:14:35.808Z"
      },

   into this:

      [
        {id: 0, group: 0, content: 'item 0', start: new Date(2014, 3, 17), end: new Date(2014, 3, 21)},
        {id: 1, group: 0, content: 'item 1', start: new Date(2014, 3, 19), end: new Date(2014, 3, 20)},
        {id: 2, group: 1, content: 'item 2', start: new Date(2014, 3, 16), end: new Date(2014, 3, 24)},
        {id: 3, group: 1, content: 'item 3', start: new Date(2014, 3, 23), end: new Date(2014, 3, 24)},
        {id: 4, group: 1, content: 'item 4', start: new Date(2014, 3, 22), end: new Date(2014, 3, 26)},
        {id: 5, group: 2, content: 'item 5', start: new Date(2014, 3, 24), end: new Date(2014, 3, 27)}
      ];
*/
