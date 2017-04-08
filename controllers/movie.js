var Movie = require('../models/movie');
var User = require('../models/user');
var Tag = require('../models/tag');
var Topic = require('../models/topic');
var Resource = require('../models/resource');
var UserBuyMovie = require('../models/userbuymovie');
var adminController = require('./admin');
var xss = require('xss');
var async = require('async');
var moment = require('moment');
var sharp = require('sharp');
var redis = require("redis");
var _ = require("underscore");
var client = redis.createClient();
var fs = require('fs');
var request = require('request');

exports.post = function(req, res) {

    req.checkBody({
      'title': {
        notEmpty: true,
        errorMessage: '请填写正确的名称'
      },
      'doctor': {
        notEmpty: true,
        errorMessage: '请输入正确的导演信息'
      },
      'players': {
        notEmpty: true,
        errorMessage: '请输入正确的主演信息'
      },
      'country': {
        notEmpty: true,
        errorMessage: '请输入正确的发行国家'
      },
      'year': {
        notEmpty: true,
        isInt: {
          options: [{ min: 1900, max: 2020 }]
        },
        errorMessage: '请输入正确的上映年份'
      },
      'types': {
        notEmpty: true,
        errorMessage: '请选择正确的电影类型'
      },
      'summary': {
        notEmpty: true,
        errorMessage: '请输入正确的剧情简介'
      },
      'resources': {
        notEmpty: true,
        errorMessage: '请务必输入下载资源'
      }

    });
    var errors = req.validationErrors();
    if (errors) {
      req.flash('error', errors);
      return res.redirect('/post');
    };
    var path;
    var destination;
    var filename;
    if(req.file === undefined) {
      if(req.body.eimg == '') {
        req.flash('error', {'msg': '请上传正确的海报！'});
        return res.redirect('/post');
      } else {
        var src = req.body.eimg;
        var filetype = src.substr(-3,3);
        console.log(filetype=='jpg');
        if(filetype != 'jpg') {
          req.flash('error', {'msg': '请上传正确的海报！'});
          return res.redirect('/post');
        }
        destination = './public/uploads';
        filename= "img-"+Date.now()+".jpg";
        path = destination+"/" + filename;
        var stream = request(src).pipe(fs.createWriteStream(path));
        stream.on('finish', function() {
          sharp(path)
            .resize(400,400)
            .quality(70)
            .toFile(destination + '/400/' + filename , function(err) {
              if(err) throw err;
            });
        });
      }
    }else {
      path = req.file.path;
      destination = req.file.destination;
      filename = req.file.filename;
      sharp(path)
        .resize(400,400)
        .quality(70)
        .toFile(destination + '/400/' + filename , function(err) {
          if(err) throw err;
        });
    }
    var resources = [].concat(req.body.resources);
    for(var i = 0; i < resources.length; i++) {
      var resource = resources[i];
      var typeid = checkResTypeId(resource);
      if(!typeid) {
        req.flash('error', {'msg': '输入资源类型有误！'});
        return res.redirect('/post');
      }

    }
    
    var summary = req.body.summary;
    var htmlsummary = xss(summary, {
      whiteList: [],
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script']
    });
    var user= req.session.user;
    var movieObj = {
      title: req.body.title,
      doctor: req.body.doctor,
      players: req.body.players,
      country: req.body.country,
      year: req.body.year,
      types: req.body.types,
      summary: htmlsummary,
      img: filename,
      creator: user._id
    };
    var movie = new Movie(movieObj);
    movie.save(function(err, movie) {
      if(err) {
        console.log(err);
      }
      var resources_id = [];
      for(var i=0; i<resources.length;i++){
        var resource = resources[i];
        var typeid = checkResTypeId(resource);
        var resourceObj = {
          resource: resource,
          typeid: typeid,
          tomovie: movie._id,
          creator: user._id
        }
        var newresource = new Resource(resourceObj);
        newresource.save(function(err, resource) {
          resources_id.push(resource._id);
        });
      }
        
      Movie.findById(movie._id, function(err, themovie) {
          for(var i =0; i< resources_id.length; i++){
             themovie.resources.push(resources_id[i]);
          }
          if(!req.session.user.isadmin && req.session.user.role.isexam) {
            themovie.review = 1;
          }
          themovie.save(function(err) {
            if(err) {
              console.log(err);
            }
            adminController.addCounts(req.session.user._id, 3,req.roles);
            if(req.session.user.isadmin) {
              req.flash('success', '恭喜，发布电影成功！');
              return res.redirect('/movie/'+ movie._id);
            }
            if(!req.session.user.role.isexam){
              req.flash('success', '恭喜，发布电影成功！');
              res.redirect('/movie/'+movie._id);
            }else{
              req.flash('success', '新人！您的帖子进入审核区，审核通过即可成为正式会员，享受特权！');
              res.redirect('/');
            }
          });
      });
      
    });
}

exports.getMovie = function(req, res) {
    var id =  req.params.id;
    var userid;
    if (req.session.user) {
      userid = req.session.user._id;
    }
    async.parallel({
      tags: function(callback) {
           callback(null, req.tags);
      },
      movie: function(callback) {
          Movie.findByIdAndUpdate(id, {$inc: {pv: 1}})
                      .populate('types','_id tag')
                      .populate('creator', '_id name avatar')
                      .populate('resources', 'resource typeid')
                      .exec(function(err,movie) {
                        if(err) console.log(err);
                         callback(null,movie);
                      });
      },
      userbuymovie: function(callback) {
        UserBuyMovie.find({movieid: id, userid: userid})
                                     .count(function(err, count){
                                       if(err) {
                                        console.log(err);
                                       }
                                       callback(null, count);
                                     });
      },
      userstopics: function(callback) {
        Topic.find({creator: userid})
                   .exec(function(err, topics) {
                    if(err) {
                      console.log(err);
                    }
                    callback(null, topics);
                   })
      },
      movieintopics: function(callback) {
        Topic.find({movies: id})
                   .select('topic _id')
                   .sort('-pv')
                   .limit(10)
                   .exec(function(err, topics) {
                    if(err) {
                      console.log(err);
                    }
                    callback(null, topics);
                   })
      }
      },
        function(err, results) {
          if(!results.movie) {
            return res.status(404).send('此页面已经不存在了！');
          }
          if(results.movie.review==1 || results.movie.review==2){
            return res.status(404).send( '此页面已经不存在了！');
          }
          var count = results.userbuymovie;
          if(results.movie.creator._id == userid) {
            count = 1;
          }
          recommendByRedis(results.movie, function(err, removies) {
            if(err) {
              console.log(err);
            }
            var title = results.movie.title +'('+ results.movie.year + '年电影)_下载,百度云网盘,bt磁力链接,电驴ED2K';
            var pubdate = moment(results.movie.meta.createAt).format('YYYY-MM-DD HH:mm:ss');
            var tags = results.tags;
            var movie = results.movie;
            var topics = results.userstopics;
            var movieintopics = results.movieintopics;
            res.render('article', {
                title: title,
                hots: req.hots,
                buy: count,
                user: req.session.user,
                pubdate: pubdate,
                topics: topics,
                movieintopics: movieintopics,
                removies: removies,
                tags: tags,
                movie: movie,
                error: req.flash('error'),
                success: req.flash('success').toString()
            });
          });
          
        }
      );
}

exports.new = function(req, res) {
    res.render('post', {
      title: '发布电影',
      tags: req.tags,
      user: req.session.user,
      success: req.flash('success').toString(),
      error: req.flash('error')
    });
  }

  exports.delete = function(req, res) {
    var id = req.query.id;

    if(id) {
      Movie.update({_id: id}, { review: 2})
                  .exec(function(err, movie){
                    if(err){
                      console.log(err);
                      res.json({success: 0});
                    }else {
                      req.flash('error', {'msg':'成功删除页面！'});
                      res.json({success: 1});
                    }
                  });
    }
  }

  exports.getupdate = function(req, res) {
    var id = req.params.id;
    Movie.findOne({_id: id})
                .exec( function(err, movie) {
                  res.render('update', {
                    title: '编辑' + movie.title,
                    movie: movie,
                    tags: req.tags,
                    error: req.flash('error'),
                    success: req.flash('success').toString(),
                    user: req.session.user
                  });
                });
  }
  exports.postupdate = function(req, res) {
    var id = req.params.id;
    var title = req.body.title;
    var doctor = req.body.doctor;
    var players = req.body.players;
    var country = req.body.country;
    var year = req.body.year;
    var types =  req.body.types;
    var img;
    req.checkBody({
      'title': {
        notEmpty: true,
        errorMessage: '请填写正确的名称'
      },
      'doctor': {
        notEmpty: true,
        errorMessage: '请输入正确的导演信息'
      },
      'players': {
        notEmpty: true,
        errorMessage: '请输入正确的主演信息'
      },
      'country': {
        notEmpty: true,
        errorMessage: '请输入正确的发行国家'
      },
      'year': {
        notEmpty: true,
        isInt: {
          options: [{ min: 1900, max: 2020 }]
        },
        errorMessage: '请输入正确的上映年份'
      },
      'types': {
        notEmpty: true,
        errorMessage: '请选择正确的电影类型'
      },
      'summary': {
        notEmpty: true,
        errorMessage: '请输入正确的剧情简介'
      }

    });
    var errors = req.validationErrors();
    if (errors) {
      req.flash('error', errors);
      return res.redirect('back');
    };
    if(req.file === undefined) {
      img = req.body.eimg;
    }else{
      sharp(req.file.path)
        .resize(400,400)
        .quality(70)
        .toFile(req.file.destination + '/400/' + req.file.filename , function(err) {
          if(err) throw err;
        });
        img = req.file.filename;
    }
    var summary = req.body.summary;
    var htmlsummary = xss(summary, {
      whiteList: [],
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script']
    });
    Movie.findOne({_id: id})
                .exec(function(err, movie){
                  movie.title = title;
                  movie.doctor = doctor;
                  movie.players = players;
                  movie.country = country;
                  movie.year = year;
                  movie.types = types;
                  movie.img = img;
                  movie.summary = htmlsummary;
                  movie.save(function(err, movie) {
                    if(err) {
                      console.log(err);
                    }
                    res.redirect('/movie/' + id);
                  });
                });
  }

 exports.gethots = function(req, res) {
    res.render('hots', {
      title: '一周热门电影排行榜',
      hots: req.hots,
      user: req.session.user,
      success: req.flash('success').toString(),
      error: req.flash('error')
    });
 }

exports.search = function(req, res) {
  var movietitle = req.query.title;
  var reg = new RegExp(movietitle);
  if(movietitle) {
    Movie.find({title: reg})
                .where({'review': 3})
                .limit(10)
                .exec(function(err, movies){
                  if(err) {
                    res.json({success: 0});
                  }
                  res.json(movies);
                });
  }

}

 exports.checkLimitPost = function(req, res, next) {
    if (req.session.user.isadmin) {
      return next();
    }
    var now = new Date();
    var day = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
    // var endday = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + (now.getDate()+1);
    var start = new Date(day);
    // var end = new Date(endday);
    Movie.find({creator: req.session.user._id})
                .where('meta.createAt').gt(start)
                .count(function(err, count) {
                  if(err) {
                    console.log(err);
                  }
                  if(count >= req.session.user.role.limitposts) {
                    req.flash('error', {'msg': "对不起，您所在用户组每日只能发布" + req.session.user.role.limitposts + "篇电影帖子"});
                    return res.redirect('/');
                  }
                  next();
                });
  }

function checkResTypeId( resource) {
    if( /pan.baidu.com\/s\/[\s\S]{8}/i.test(resource)){
          return 1;
        }else if(/magnet:\?xt=urn:btih:[\s\S]{40}/.test(resource)){
          return 2;
        }else if(/^ed2k:\/\/\|file\|(.*)\|\/$/.test(resource)){
          return 3;
        }else if(/yunpan.cn\/[\s\S]{13}/i.test(resource)){
          return 4;
        }else{
          return false;
        }
  }

exports.hotsByRedis = function(req, res, next) {
  getHotsFromRedis(function(err, hots) {
    if(err) return next(err);

    if(!hots) {
      getHotsFromMongo( function(err, hots) {
        if(err) return next(err);
        if(!hots) {
          return next(new Error('Hots not found'));
        }
        req.hots = hots;
        return next();
      });
    } else {
      req.hots = hots;
      return next();
    }
  });
}

function getHotsFromMongo(cb) {
  var now = new Date();
  var date = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  Movie
    .find({'review': 3})
    .where('meta.updateAt').gte(date)
    .populate('types', '_id tag')
    .limit(100)
    .sort('-pv')
    .exec(function(err, hots) {
                if(hots) {
                  client.setex('hots', 3600, JSON.stringify(hots));
                }
      return cb(err, hots);
    });
}

function getHotsFromRedis(cb) {
  client.get('hots', function(err, hots) {
    if(err) return cb(err, null);
    try {
      hots = JSON.parse(hots);
    } catch(e) {
      return cb(e, null);
    }
    return cb(err, hots);
  });
}

recommendByRedis = function(movie, cb) {
  getRemoviesFromRedis(movie, function(err, removies) {
    if(err) {
      return next(err);
    }
    if(!removies) {
      getRemoviesFromMongo(movie, function(err, removies) {
        if(err) {
          return next(err);
        }
        return cb(null, removies);
      });

    } else {
      return cb(null, removies);
    }
  });
}

function getRemoviesFromMongo(movie, cb) {
  var id = movie._id;
  var movietypes = _.clone(movie.types);
  var types = [];
  var query = {};
  var recomid = 'removie_' + id;
  var listcounts = 8;
  if(movietypes.length>1) {
    for(var i = 0; i < movietypes.length; i++) {
      if(movietypes[i].tag == '剧情') {
        movietypes.splice(i,1);
      }
    }
  }
  if(movietypes.length>2) {
    var fenzu = function(arr) {
        var result = [];
        for(var i = 0; i < arr.length; i++) {
          var first = arr[i];
          var left = arr.slice(i+1);
          for(var j = 0; j < left.length; j++) {
            var obj = [];
            obj.push(first);
            obj.push(left[j]);
            result.push(obj);
          }
        }
        return result;
      }
    types = fenzu(movietypes);
    query.$or=[];
    for(var i = 0; i<types.length; i++) {
      // find({$or:[{types: {$all: typeid}}, {types: {$all: typeid}}]})
      var allquery = {};
      var typeid = _.pluck(types[i], '_id');
      allquery.types = {$all: typeid}
      query.$or.push(allquery);
    }
  } else {
    types = movietypes;
    // find({types: {$all: typeid}})
    var typeid = _.pluck(types, '_id');
    var allquery = {};
    allquery.$all = typeid
    query.types = allquery;
  }
  
  Movie.find(query)
              .where('year').gt(movie.year-8).lt(movie.year+8)
              .where({'review': 3})
              .select('_id title img country types')
              .limit(50)
              .exec(function(err, movies) {
                var listmovies = _.filter(movies, function(obj) {
                  return obj._id != id.toString();
                });
                var count = listmovies.length;
                var groupmoviesArr = [];
                if(count>= listcounts){
                  var weightArr = quanObj(movie, listmovies);
                  var groupweightObj= _.sortBy(weightArr, function(data) {
                    return - data.quanzhong;
                  });
                  groupmoviesArr = _.pluck(groupweightObj, 'arr');
                  groupmoviesArr = groupmoviesArr.slice(0,8);
                  if(groupmoviesArr) {
                    client.setex(recomid, 3600,  JSON.stringify(groupmoviesArr));
                  }
                  return cb(err, groupmoviesArr);
                } else {
                  var leftcount = listcounts - count;
                  Movie.find({types: {$in:  _.pluck(movietypes, '_id')}, _id: {$nin: _.pluck(movies, '_id')}})
                              .sort('-meta.updateAt')
                              .limit(leftcount)
                              .select('_id title img country types')
                              .exec(function(err, leftmovies) {
                                if(err) {
                                  console.log(err);
                                }
                                groupmoviesArr = listmovies.concat(leftmovies);
                                if(groupmoviesArr) {
                                  client.setex(recomid, 3600,  JSON.stringify(groupmoviesArr));
                                }
                                return cb(err, groupmoviesArr);
                              })

                }
                

              });
  var quanObj = function(movie, listmovies){
    var quanzhongObj = [];
    for(var o = 0; o<listmovies.length; o++) {
      var quanzhong = quan(movie, listmovies[o]);
      quanzhongObj.push(quanzhong);
    }
    return quanzhongObj;
  }
  var quan = function(movie, listmovie) {
    var movietypesid = _.pluck(movie.types, '_id');
    var quanzhong = 0;
    var obj={};
    for(var i = 0; i<movietypesid.length; i++) {
      for(var j=0; j<listmovie.types.length; j++) {
        if(listmovie.types[j]==movietypesid[i].toString()) {
              quanzhong++;
        }
      }
    }
    if(listmovie.country == movie.country) {
      quanzhong++;
    }
    
    obj.quanzhong = quanzhong;
    obj.arr = listmovie;
    return obj;
  }
}

function getRemoviesFromRedis(movie, cb) {
  var id = movie._id;
  var recomid = 'removie_' + id;
  client.get(recomid, function(err, removies) {
    if(err) return cb(err, null);
    try {
      removies = JSON.parse(removies);
    } catch(e) {
      return cb(e, null);
    }
    return cb(err, removies);
  });
}

