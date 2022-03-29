// Import dependencies
const express = require('express');
const dotenv = require('dotenv');
const http = require('http');
const socketio = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');
//Import classes
const { LiveGames } = require('./utils/liveGames');
const { Players } = require('./utils/players');

const games = new LiveGames();
const players = new Players();
// Load env vars
dotenv.config({ path: './config/config.env' });

const app = express();

app.use(express.static(__dirname + '/public'));

const PORT = process.env.PORT || 8000;

//Cross-Origin-Embedder-Policy
app.use(cors());
//Security Headers
app.use(helmet());

//Starting server on port 8000
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(
    `Server running in ${process.env.NODE_ENV} mode on port ${PORT}.`
  );
});

process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);

  // Close server & exit process
  server.close(() => process.exit(1));
});

/* app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
}); */

//When a connection to server is made from client
const io = socketio(server);

io.on('connection', (socket) => {
  //When host connects for the first time
  socket.on('host-join', (data) => {
    /*  const gamePIN = Math.floor(Math.random() * 90000) + 10000; //new Pin for game */
    const gamePIN = 8888;
    games.addGame(
      gamePIN,
      socket.id,
      false,
      {
        playersAnswered: 0,
        questionLive: false,
        gameid: data.id,
        category: data.category,
        failQuota: data.failQuota,
        numFailQuota: data.numFailQuota,
        time: data.time,
        feedback: data.feedback,
        firstAns: false,
        countCorrect: 0,
        question: 1,
        questions: null,
      },
      [
        /* { ip: '127.0.0.1', date: Date.now() + 15 * 60 * 1000 } */
      ]
    );

    //Creates a game with pin and host id
    const game = games.getGame(socket.id); //Gets the game data

    socket.join(game.pin); //The host is joining a room based on the pin
    /*    console.log(game); */
    console.log('Game Created with pin:', game.pin);
    //console.log(games);
    socket.emit('showGamePin', { pin: game.pin });
  });

  //When the host connects from the game view
  socket.on('host-join-game', async (data) => {
    const oldHostId = data.id;
    const token = data.token;
    // console.log(data.id);
    const game = games.getGame(oldHostId); // Gets game with old host id
    //console.log(game);
    if (game) {
      game.hostId = socket.id; //Change the game host id to new host id
      socket.join(game.pin);
      const playerData = players.getPlayers(oldHostId); //Gets player in game

      for (var i = 0; i < Object.keys(players.players).length; i++) {
        if (players.players[i].hostId == oldHostId) {
          players.players[i].hostId = socket.id;
        }
      }

      const gameid = game.gameData['gameid'];
      //Find and return quiz question's from db
      try {
        const config = {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        };

        const res = await axios.get(
          `${process.env.REACT_APP_URL_API}/api/v1/game/play/${gameid}`,
          config
        );
        const data = [];
        const leaders = ['', ''];
        if (res.data.success) {
          game.gameData.questions = res.data.data.questions.question;
          data.push(res.data.data.questions.question[0]);
          const questionNum = game.gameData.question;
          const questionsLength = game.gameData.questions.length;
          socket.emit('gameQuestions', {
            data,
            playersInGame: playerData.length,
            questionNum,
            questionsLength,
            leaders,
          });
          io.to(game.pin).emit('gameStartedPlayer');
          game.gameData.questionLive = true;

          //console.log(game);
        } else {
          /* console.log('Fetch question error'); */
          socket.emit('noGameFound');
        }
      } catch (err) {
        /* console.log(`Fetch questions error ${err}`); */
        socket.emit('noGameFound');
      }
    } else socket.emit('noGameFound'); //No game was found, redirect
  });

  //When player connects for the first time
  socket.on('player-join', (params) => {
    let gameFound = false; //If game is found with pin provider by player

    //For each game in the Games class
    for (let i = 0; i < games.games.length; i++) {
      //If the pin is equal to one of the game's pin
      if (params.pin == games.games[i].pin) {
        const hostId = games.games[i].hostId; //Get the id of host of game
        const clientIp = socket.handshake.headers['x-forwarded-for'];
        let banPlayer = false;

        if (games.games[i].banData.length !== 0) {
          games.games[i].banData.forEach((data) => {
            if (data.ip == clientIp && data.date > Date.now()) {
              banPlayer = true;
              console.log('Ban Player', clientIp);
            }
          });
        }
        if (!banPlayer) {
          console.log('Player connected to game');

          players.addPlayer(
            hostId,
            socket.id,
            socket.handshake.headers['x-forwarded-for'] ||
              socket.handshake.address,
            params.name,
            {
              score: 0,
              answer: '',
              correctAns: 0,
              falseAns: 0,
            }
          ); //add player to game
          socket.join(params.pin); //Player is joining room based pin
          socket.emit('successPlayerJoin');
          const playersInGame = players.getPlayers(hostId); //Getting all players in game
          //console.log(playersInGame);
          io.to(params.pin).emit('updatePlayerLobby', playersInGame); //Sending host player data to display
          gameFound = true; //Game has been found
        }
      }
    } //If the game has not been found
    if (gameFound == false) {
      socket.emit('noGameFound'); //Player is sent back to 'join' page because game was not found with pin
    }
  });

  //When the player connects from game view
  socket.on('player-join-game', (data) => {
    const player = players.getPlayer(data.id);

    if (player) {
      const game = games.getGame(player.hostId);
      socket.join(game.pin);
      player.playerId = socket.id; //Update player id with socket id
      const playerData = players.getPlayers(game.hostId);
      socket.emit('playerGameData', playerData);
    } else {
      socket.emit('noGameFound'); //No player found
    }
  });

  socket.on('disconnect', () => {
    const game = games.getGame(socket.id); //Finding game with socket id

    //If a game hosted by that id is found, the socket disconnected is a host

    if (game) {
      //Checking to see if host was disconnect or was sent to game view

      /* if (game.gameLive == false) { */
      games.removeGame(socket.id); // Remove the game from games class
      console.log('Game ended with pin:', game.pin);

      const playersToRemove = players.getPlayers(game.hostId); //Getting all players in the game

      //For each player in the game
      for (let i = 0; i < playersToRemove.length; i++) {
        players.removePlayer(playersToRemove[i].playerId); //Removing each player from player class
      }
      //console.log(players);
      //console.log(games);
      io.to(game.pin).emit('hostDisconnect'); //Send player back to 'join' screen
      console.log('Host Disconnect');
      socket.leave(game.pin); //Socket is leaving room
      /*  } */
    } else {
      //No game has been found, so it is a player socket that has disconnected
      const player = players.getPlayer(socket.id); // Getting player with socket.id

      //If a player has been found with that id
      if (player) {
        const hostId = player.hostId; //Gets id of host of the game

        const game = games.getGame(hostId); //Gets game data with hostId

        const pin = game.pin; //Gets the pin of the game;

        if (game.gameLive == false) {
          players.removePlayer(socket.id); //Removes player from players class

          const playersInGame = players.getPlayers(hostId); //Gets remainig players in game

          io.to(pin).emit('updatePlayerLobby', playersInGame); //Sends data to host to update screen
          console.log('User disconnect');
          socket.leave(pin); //Player is leaving the room
        } else {
          socket.leave(pin);
        }
      }
    }
  });

  socket.on('player-kick', (params) => {
    const playerId = params.id;
    //No game has been found, so it is a player socket that has disconnected
    const player = players.getPlayer(playerId); // Getting player with socket.id
    //console.log(player);
    //If a player has been found with that id
    if (player) {
      const hostId = player.hostId; //Gets id of host of the game

      const game = games.getGame(hostId); //Gets game data with hostId

      const pin = game.pin; //Gets the pin of the game;

      if (game.gameLive == false) {
        players.removePlayer(playerId); //Removes player from players class

        //Find player's socket
        let clientSocket = [];
        socket.nsp.sockets.forEach((socket) => {
          /* console.log(socket.id); */
          if (socket.id === playerId) {
            //console.log(socket);
            clientSocket.push(socket);
          }
        });
        const playersInGame = players.getPlayers(hostId); //Gets remainig players in game
        //console.log(players);
        clientSocket[0].emit('kickPlayer'); //Player is sent back to 'join' page because host kick player
        clientSocket[0].leave(pin); //Player is leaving the room
        clientSocket[0].disconnect(true); //Player is disconnecting from server
        io.to(pin).emit('updatePlayerLobby', playersInGame); //Sends data to host to update screen
        //console.log('Send Players');
      }
    }
  });

  socket.on('player-ban', (params) => {
    const playerId = params.id;
    //No game has been found, so it is a player socket that has disconnected
    const player = players.getPlayer(playerId); // Getting player with socket.id
    //console.log(player);
    //If a player has been found with that id
    if (player) {
      const hostId = player.hostId; //Gets id of host of the game

      const game = games.getGame(hostId); //Gets game data with hostId

      const pin = game.pin; //Gets the pin of the game;

      if (game.gameLive == false) {
        games.addBanData(game, {
          ip: player.playerIp,
          date: Date.now() + 15 * 60 * 1000,
        });

        //console.log(games.getGame(hostId));
        players.removePlayer(playerId); //Removes player from players class

        //Find player's socket
        let clientSocket = [];
        socket.nsp.sockets.forEach((socket) => {
          /* console.log(socket.id); */
          if (socket.id === playerId) {
            //console.log(socket);
            clientSocket.push(socket);
          }
        });
        const playersInGame = players.getPlayers(hostId); //Gets remainig players in game
        //console.log(players);
        clientSocket[0].emit('banPlayer'); //Player is sent back to 'join' page because host ban player's ip
        clientSocket[0].leave(pin); //Player is leaving the room
        clientSocket[0].disconnect(true); //Player is disconnecting from server
        io.to(pin).emit('updatePlayerLobby', playersInGame); //Sends data to host to update screen

        //console.log('Send Players');
      }
    }
  });

  //When the host starts the game
  socket.on('startGame', () => {
    const game = games.getGame(socket.id); //Get the game based on socket.id
    game.gameLive = true;
    socket.emit('getStarted', game.hostId); //Tell player and host that game has started
  });

  socket.on('nextQuestion', function () {
    const playerData = players.getPlayers(socket.id);
    //console.log(playerData);
    //Reset players current answer to 0
    for (let i = 0; i < Object.keys(players.players).length; i++) {
      if (players.players[i].hostId == socket.id) {
        players.players[i].gameData.answer = 0;
      }
    }
    const game = games.getGame(socket.id);

    game.gameData.playersAnswered = 0;
    game.gameData.countCorrect = 0;
    game.gameData.firstAns = false;
    game.gameData.questionLive = true;
    game.gameData.question += 1;

    if (game.gameData.questions.length >= game.gameData.question) {
      const data = [];
      const questionsLength = game.gameData.questions.length;
      const questionNum = game.gameData.question;
      data.push(game.gameData.questions[questionNum - 1]);
      //console.log(data);

      const playersInGame = players.getPlayers(game.hostId);
      var byScore = playersInGame.slice(0);
      byScore.sort(function (a, b) {
        return b.gameData.score - a.gameData.score;
      });

      const leaders = [];
      byScore[0] ? leaders.push(byScore[0].name) : leaders.push('');
      byScore[1] ? leaders.push(byScore[1].name) : leaders.push('');
      socket.emit('gameQuestions', {
        data,
        playersInGame: playerData.length,
        questionNum,
        questionsLength,
        leaders,
      });
    } else {
      const playersInGame = players.getPlayers(game.hostId);
      var byScore = playersInGame.slice(0);
      byScore.sort(function (a, b) {
        return b.gameData.score - a.gameData.score;
      });
      //console.log(byScore);
      io.to(game.pin).emit('GameOver', byScore);
      game.gameLive = false;
    }
    io.to(game.pin).emit('nextQuestionPlayer');
  });

  socket.on('hostEndGame', () => {
    const game = games.getGame(socket.id);
    const playersInGame = players.getPlayers(game.hostId);
    var byScore = playersInGame.slice(0);
    byScore.sort(function (a, b) {
      return b.gameData.score - a.gameData.score;
    });
    //console.log(byScore);
    io.to(game.pin).emit('GameOver', byScore);
    game.gameLive = false;
  });

  socket.on('playerAnswer', function (choice) {
    //console.log(choice);
    let ansFlag = false;
    const player = players.getPlayer(socket.id);
    const hostId = player.hostId;
    const playerNum = players.getPlayers(hostId);
    const game = games.getGame(hostId);
    if (game.gameData.questionLive == true) {
      //If the question is still live
      player.gameData.answer = choice;
      game.gameData.playersAnswered += 1;

      const questionNum = game.gameData.question;
      const correctAnswer = game.gameData.questions[questionNum - 1].correct;
      //Checks player answer with correct answer

      if (choice == correctAnswer) {
        /*  player.gameData.score += 100; */
        game.gameData.countCorrect += 1;
        player.gameData.correctAns += 1;
        ansFlag = true;
        game.gameData.firstAns = true;
        socket.emit('answerResult', true);
      } else {
        game.gameData.firstAns = true;
        player.gameData.falseAns += 1;
      }
      io.to(game.pin).emit('getTime', { playerId: socket.id, ansFlag });
      //Check if all players answered
      if (game.gameData.playersAnswered == playerNum.length) {
        let chartBars = [];
        let answerA = 0;
        let answerB = 0;
        let answerC = 0;
        let answerD = 0;
        let answerE = 0;
        let total = 0;

        game.gameData.questionLive = false; // Question has been ended when all players answered under time
        const playerData = players.getPlayers(game.hostId);

        //Filler Slide Calculator
        const rateCorrect =
          (game.gameData.countCorrect / playerData.length) * 100;
        let fillerSlideFeedback;
        if (rateCorrect < 50) {
          fillerSlideFeedback = 'άσχημα';
        } else if (rateCorrect >= 50 && rateCorrect < 80) {
          fillerSlideFeedback = 'καλά';
        } else {
          fillerSlideFeedback = 'εξαιρετικά';
        }
        //Chart Bars Calculator
        if (playerData.length > 0) {
          for (let i = 0; i < playerData.length; i++) {
            if (playerData[i].gameData.answer == 'A') {
              answerA += 1;
            } else if (playerData[i].gameData.answer == 'B') {
              answerB += 1;
            } else if (playerData[i].gameData.answer == 'C') {
              answerC += 1;
            } else if (playerData[i].gameData.answer == 'D') {
              answerD += 1;
            } else if (playerData[i].gameData.answer == 'E') {
              answerE += 1;
            }
            total += 1;
          }
          //Gets values for graph
          answerA = 300 - (answerA / total) * 100;
          chartBars[0] = answerA >= 0 ? answerA : 0;
          answerB = 300 - (answerB / total) * 100;
          chartBars[1] = answerB >= 0 ? answerB : 0;
          answerC = 300 - (answerC / total) * 100;
          chartBars[2] = answerC >= 0 ? answerC : 0;
          answerD = 300 - (answerD / total) * 100;
          chartBars[3] = answerD >= 0 ? answerD : 0;
          answerE = 300 - (answerE / total) * 100;
          chartBars[4] = answerE >= 0 ? answerE : 0;
        }

        const feedback = game.gameData.feedback;
        io.to(game.pin).emit('questionOver', {
          playerData,
          feedback,
          fillerSlideFeedback,
          chartBars,
        }); //Tell everyone that question is over
      } else {
        //update host screen of num players answered
        io.to(game.pin).emit('updatePlayersAnswered', {
          playersInGame: playerNum.length,
          playersAnswered: game.gameData.playersAnswered,
        });
      }
    }
  });

  socket.on('time', function (data) {
    const game = games.getGame(socket.id);
    const playerId = data.playerId;
    const player = players.getPlayer(playerId);
    const ansFlag = data.ansFlag;
    const ansTime = data.time.current;

    //Find player's socket
    let clientSocket = [];
    socket.nsp.sockets.forEach((socket) => {
      /* console.log(socket.id); */
      if (socket.id === playerId) {
        //console.log(socket);
        clientSocket.push(socket);
      }
    });

    if (game.gameData.category == 1) {
      pointSystemCalc(game, player, ansTime, ansFlag);
    } else if (game.gameData.category == 2) {
      pointSystemNPCalc(game, player, ansTime, ansFlag);
    } else if (game.gameData.category == 3) {
      simpleGameCalc(game, player, ansFlag, clientSocket);
    } else if (game.gameData.category == 4) {
      simpleGameNPCalc(game, player, ansFlag, clientSocket);
    } else if (game.gameData.category == 5) {
      buzzerModeCalc(game, player, ansFlag, clientSocket);
    }
  });

  socket.on('timeUp', function () {
    const game = games.getGame(socket.id);
    game.gameData.questionLive = false;
    const playerData = players.getPlayers(game.hostId);
    let chartBars = [];
    let answerA = 0;
    let answerB = 0;
    let answerC = 0;
    let answerD = 0;
    let answerE = 0;
    let total = 0;
    let fillerSlideFeedback = null;
    if (playerData.length > 0) {
      //Filler Slide Calculator
      const rateCorrect =
        (game.gameData.countCorrect / playerData.length) * 100;
      let fillerSlideFeedback;
      if (rateCorrect < 50) {
        fillerSlideFeedback = 'άσχημα';
      } else if (rateCorrect >= 50 && rateCorrect < 80) {
        fillerSlideFeedback = 'καλά';
      } else {
        fillerSlideFeedback = 'εξαιρετικά';
      }
      //Chart Bars Calculator
      for (let i = 0; i < playerData.length; i++) {
        if (playerData[i].gameData.answer == 'A') {
          answerA += 1;
        } else if (playerData[i].gameData.answer == 'B') {
          answerB += 1;
        } else if (playerData[i].gameData.answer == 'C') {
          answerC += 1;
        } else if (playerData[i].gameData.answer == 'D') {
          answerD += 1;
        } else if (playerData[i].gameData.answer == 'E') {
          answerE += 1;
        }
        total += 1;
      }
      //Gets values for graph
      answerA = 300 - (answerA / total) * 100;
      chartBars[0] = answerA >= 0 ? answerA : 0;
      answerB = 300 - (answerB / total) * 100;
      chartBars[1] = answerB >= 0 ? answerB : 0;
      answerC = 300 - (answerC / total) * 100;
      chartBars[2] = answerC >= 0 ? answerC : 0;
      answerD = 300 - (answerD / total) * 100;
      chartBars[3] = answerD >= 0 ? answerD : 0;
      answerE = 300 - (answerE / total) * 100;
      chartBars[4] = answerE >= 0 ? answerE : 0;
    }

    const feedback = game.gameData.feedback;
    io.to(game.pin).emit('questionOver', {
      playerData,
      feedback,
      fillerSlideFeedback,
      chartBars,
    });
  });

  socket.on('liveGame-leaderboard', function (data) {
    const game = games.getGame(data);

    if (game) {
      const playersInGame = players.getPlayers(game.hostId);
      const byScore = playersInGame.slice(0);
      byScore.sort(function (a, b) {
        return b.gameData.score - a.gameData.score;
      });
      socket.emit('live-score', byScore);
      //console.log(byScore);
    } else {
      socket.emit('noGameFound');
    }
  });
});

//Calculate Score for Point System game mode
const pointSystemCalc = (game, player, ansTime, ansFlag) => {
  if (ansFlag) {
    let time = ansTime / game.gameData.time;
    const score = time * 100;
    player.gameData.score += score;
  } else {
    let score = 1 / player.gameData.falseAns;
    score = -(score * 100);
    player.gameData.score += score;
  }
};

//Calculate Score for Point System - No Penalty game mode
const pointSystemNPCalc = (game, player, ansTime, ansFlag) => {
  if (ansFlag) {
    let time = ansTime / game.gameData.time;
    const score = time * 100;
    player.gameData.score += score;
  }
};

//Calculate Score for Simple Game - No Penalty game mode
const simpleGameCalc = (game, player, ansFlag, clientSocket) => {
  if (ansFlag) {
    /*  if (game.gameData.failQuota) {
      if (game.gameData.numFailQuota >= player.gameData.falseAns) {
        player.gameData.score += 1;
      } else {
        clientSocket[0].emit('playerDisable');
      }
    } else { */
    player.gameData.score += 1;
    /* } */
  } else {
    if (game.gameData.failQuota) {
      if (game.gameData.numFailQuota >= player.gameData.falseAns) {
        player.gameData.score -= 1;
      } else {
        clientSocket[0].emit('playerDisable');
      }
    } else {
      player.gameData.score -= 1;
    }
  }
};

//Calculate Score for Simple Game - No Penalty game mode
const simpleGameNPCalc = (game, player, ansFlag) => {
  if (ansFlag) {
    /*   if (game.gameData.failQuota) {
      if (game.gameData.numFailQuota >= player.gameData.falseAns) {
        player.gameData.score += 1;
      } else {
        clientSocket[0].emit('playerDisable');
      }
    } else { */
    player.gameData.score += 1;
    /*  } */
  } else {
    if (game.gameData.failQuota) {
      if (game.gameData.numFailQuota > player.gameData.falseAns) {
        clientSocket[0].emit('playerDisable');
      }
    }
  }
};

const buzzerModeCalc = (game, player, ansFlag) => {
  if (game.gameData.firstAns) {
    if (ansFlag) {
      /* if (game.gameData.failQuota) {
        if (game.gameData.numFailQuota >= player.gameData.falseAns) {
          player.gameData.score += 1;
        }
      } else { */
      player.gameData.score += 1;
      /*    } */
    } else {
      if (game.gameData.failQuota) {
        if (game.gameData.numFailQuota > player.gameData.falseAns) {
          clientSocket[0].emit('playerDisable');
        }
      }
    }
  }
};
