import { Component } from '@angular/core';
import { AppService } from './app.service';
import { Player } from './player.model';
import { Sort } from '@angular/material/sort';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})



export class AppComponent {
  title = 'amigos-cs2-north-wind';
  sortedData: Player[];
  partida: string = ''
  partidaGet: any = []
  players = []
  total = [];
  onlyFriends = false;

  constructor(private appService: AppService) { this.dataSource = this.total.slice(); }


  partidas = []

  displayedColumns: string[] =
    [
      'jogador',
      'mediaPartida',
      'totalDeKill',
      'totalDeDeaths',
      'kdDiff',
      'totalPartidas',
      'firstkill',
      'totalWin',
      'percentualVitoria',
      'level',
      'kdr'
    ];

  dataSource = [];

  clearPartidas() {
    this.partidas = []
    this.dataSource = []
  }


  addAllPartidas() {
    this.partidas = [
      '20588479',
      '20585951',
      '20588707',
      '20585673',
      '20583263',
      '20582998',
      '20582733',
      '20580232',
      '20579934',
      '20579670',
      '20571612',
      '20571320',
      '20571112',
      '20570886',
      '20557975',
      '20557765',
      '20557592',
      '20557437',
      '20557224',
      '20545808',
      '20545319',
      '20543410',
      '20545528',
      '20543557',
    ]
  }


  addPartidas() {
    let result = this.partidas.findIndex((r) => r === this.partida)
    if (result === -1) { this.partidas.push(this.partida) }
    this.partida = ''
  }

  searhPartida() {
    this.players = []
    for (var i = 0; i < this.partidas.length; i++) {
      this.appService.searchPartida(this.partidas[i]).subscribe(res => {

        for (var i = 0; i < res.jogos.players.team_a.length; i++) {
          this.players.push(res.jogos.players.team_a[i])
        }
        for (var i = 0; i < res.jogos.players.team_b.length; i++) {
          this.players.push(res.jogos.players.team_b[i])
        }
        this.mountObject()
      })
    }

  }

  delete(i: any) {
    this.partidas.splice(i, 1)
  }

  mountObject() {
    var diff = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id; // Gera uma chave única para cada usuário
      acc[chave] = (acc[chave] || 0) + parseInt(obj.diff); // Soma os valores para a chave
      return acc;
    }, {});

    var nb_kill = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id; // Gera uma chave única para cada usuário
      acc[chave] = (acc[chave] || 0) + parseInt(obj.nb_kill); // Soma os valores para a chave
      return acc;
    }, {});

    var death = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id; // Gera uma chave única para cada usuário

      acc[chave] = (acc[chave] || 0) + parseInt(obj.death); // Soma os valores para a chave
      return acc;
    }, {});

    var firstkill = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id; // Gera uma chave única para cada usuário

      acc[chave] = (acc[chave] || 0) + parseInt(obj.firstkill); // Soma os valores para a chave
      return acc;
    }, {});

    var totalPartidas = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id; // Gera uma chave única para cada usuário
      acc[chave] = (acc[chave] || 0) + 1; // Soma os valores para a chave
      return acc;
    }, {});

    var totalWin = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id; // Gera uma chave única para cada usuário
      acc[chave] = parseInt(obj.rating_points) >= 0 ? (acc[chave] || 0) + 1 : (acc[chave] || 0); // Soma os valores para a chave
      return acc;
    }, {});

    var nick = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id;
      acc[chave] = obj.player.nick
      return acc;
    }, {});

    var level = this.players.reduce(function (acc, obj) {
      var chave = 'user' + obj.player.id;
      acc[chave] = obj.level
      return acc;
    }, {});


    this.total = Object.keys(death).map(function (chave) {
      return {
        user: parseInt(chave.replace('user', '')),
        nick: nick[chave],
        nb_kill: parseInt(nb_kill[chave]),
        death: parseInt(death[chave]),
        diff: parseInt(diff[chave]),
        totalPartidas: parseInt(totalPartidas[chave]),
        totalWin: parseInt(totalWin[chave]),
        firstkill: parseInt(firstkill[chave]),
        level: parseInt(level[chave]),
        kdr: parseInt(nb_kill[chave]) / parseInt(death[chave]),
        mediaPartida: parseInt(nb_kill[chave]) / parseInt(totalPartidas[chave]),
        percentualVitoria: parseInt(totalWin[chave]) / parseInt(totalPartidas[chave]),
      };
    });

    const users = [292823, 492702, 211335, 364266, 742567, 564387, 435993, 1717062, 506013, 1225732, 521452]
    const totalFiltered = this.total.filter(obj => users.includes(obj.user))

    this.onlyFriends ?  this.dataSource = totalFiltered : this.dataSource = this.total;
  }

  
  showOnlyGroupTeam() {
    const users = [292823, 492702, 211335, 364266, 742567, 564387, 435993, 1717062, 506013, 1225732, 521452]
    const totalFiltered = this.total.filter(obj => users.includes(obj.user))
    this.onlyFriends ?  this.dataSource = this.total  : this.dataSource = totalFiltered
  }



  sortData(sort: Sort) {
    const users = [292823, 492702, 211335, 364266, 742567, 564387, 435993, 1717062, 506013, 1225732, 521452]
    const totalFiltered = this.total.filter(obj => users.includes(obj.user))
    const data = this.onlyFriends ? totalFiltered.slice() : this.dataSource.slice()
    if (!sort.active || sort.direction === '') {
      this.sortedData = data;
      return;
    }

    this.dataSource = data.sort((a, b) => {
      const isAsc = sort.direction === 'asc';
      switch (sort.active) {
        case 'player': return compare(a.player, b.player, isAsc);
        case 'totalPartidas': return compare(a.totalPartidas, b.totalPartidas, isAsc);
        case 'mediaPartidas': return compare(a.mediaPartidas, b.mediaPartidas, isAsc);
        case 'nb_kill': return compare(a.nb_kill, b.nb_kill, isAsc);
        case 'diff': return compare(a.diff, b.diff, isAsc);
        case 'firstkill': return compare(a.firstkill, b.firstkill, isAsc);
        case 'totalWin': return compare(a.totalWin, b.totalWin, isAsc);
        case 'kdr': return compare(a.kdr, b.kdr, isAsc);
        case 'death': return compare(a.death, b.death, isAsc);
        case 'mediaPartida': return compare(a.mediaPartida, b.mediaPartida, isAsc);
        case 'percentualVitoria': return compare(a.percentualVitoria, b.percentualVitoria, isAsc);
        case 'level': return compare(a.level, b.level, isAsc);
        default: return 0;
      }
    });
  }
}



function compare(a: number | string, b: number | string, isAsc: boolean) {
  return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
}
