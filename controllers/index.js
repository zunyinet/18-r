var Movie = require('../models/movie');
var Tag = require('../models/tag');
exports.index =  function(req, res, next) {
      var perPage = 16;
      var page = req.query.page > 0 ? req.query.page : 1;
      Movie
        .find()
        .where({'review': 3})
        .select('title _id doctor players types img')
        .populate('types', '_id tag')
        .limit(perPage)
        .skip(perPage * (page-1))
        .sort('-meta.updateAt')
        .exec( function(err, movies) {
           if(err) {
             console.log(err);
           }
           Movie.find()
                       .where({'review': 3})
                       .count(function(err, count) {
                         if(err) {
                           console.log(err);
                         }
                         res.render('index', { 
                           title: "BT老司机_老司机们的电影分享社群",
                           page: page,
                           pages: Math.ceil(count/perPage),
                           user: req.session.user,
                           tags: req.tags,
                           hots: req.hots,
                           movies: movies,
                           error: req.flash('error'),
                           success: req.flash('success').toString()
                         });
                       })
           
        });
    
  }