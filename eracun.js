//Priprava knjižnic
var formidable = require("formidable");
var util = require('util');

if (!process.env.PORT)
  process.env.PORT = 8080;

// Priprava povezave na podatkovno bazo
var sqlite3 = require('sqlite3').verbose();
var pb = new sqlite3.Database('chinook.sl3');

// Priprava strežnika
var express = require('express');
var expressSession = require('express-session');
var streznik = express();
streznik.set('view engine', 'ejs');
streznik.use(express.static('public'));
streznik.use(
  expressSession({
    secret: '1234567890QWERTY', // Skrivni ključ za podpisovanje piškotkov
    saveUninitialized: true,    // Novo sejo shranimo
    resave: false,              // Ne zahtevamo ponovnega shranjevanja
    cookie: {
      maxAge: 3600000           // Seja poteče po 60min neaktivnosti
    }
  })
);

var razmerje_usd_eur = 0.877039116;



function davcnaStopnja(izvajalec, zanr) {
  switch (izvajalec) {
    case "Queen": case "Led Zepplin": case "Kiss":
      return 0;
    case "Justin Bieber":
      return 22;
    default:
      break;
  }
  switch (zanr) {
    case "Metal": case "Heavy Metal": case "Easy Listening":
      return 0;
    default:
      return 9.5;
  }
}

// Prikaz seznama pesmi na strani
streznik.get('/', function(zahteva, odgovor) {
  if (!zahteva.session.prijavljenaStranka){
    odgovor.redirect("/prijava");
  } else {

    pb.all("SELECT Track.TrackId AS id, Track.Name AS pesem, \
            Artist.Name AS izvajalec, Track.UnitPrice * " +
            razmerje_usd_eur + " AS cena, \
            COUNT(InvoiceLine.InvoiceId) AS steviloProdaj, \
            Genre.Name AS zanr \
            FROM Track, Album, Artist, InvoiceLine, Genre \
            WHERE Track.AlbumId = Album.AlbumId AND \
            Artist.ArtistId = Album.ArtistId AND \
            InvoiceLine.TrackId = Track.TrackId AND \
            Track.GenreId = Genre.GenreId \
            GROUP BY Track.TrackId \
            ORDER BY steviloProdaj DESC, pesem ASC \
            LIMIT 100", function(napaka, vrstice) {
      if (napaka)
        odgovor.sendStatus(500);
      else {
          for (var i=0; i<vrstice.length; i++)
            vrstice[i].stopnja = davcnaStopnja(vrstice[i].izvajalec, vrstice[i].zanr);
          odgovor.render('seznam', {seznamPesmi: vrstice});

        }
            
    })
  }

})

// Dodajanje oz. brisanje pesmi iz košarice
streznik.get('/kosarica/:idPesmi', function(zahteva, odgovor) {
  var idPesmi = parseInt(zahteva.params.idPesmi);
  if (!zahteva.session.kosarica)
    zahteva.session.kosarica = [];
  if (zahteva.session.kosarica.indexOf(idPesmi) > -1) {
    zahteva.session.kosarica.splice(zahteva.session.kosarica.indexOf(idPesmi), 1);
  } else {
    zahteva.session.kosarica.push(idPesmi);
  }
  
  odgovor.send(zahteva.session.kosarica);
});

// Vrni podrobnosti pesmi v košarici iz podatkovne baze
var pesmiIzKosarice = function(zahteva, callback) {
  if (!zahteva.session.kosarica || Object.keys(zahteva.session.kosarica).length == 0) {
    callback([]);
  } else {
    pb.all("SELECT Track.TrackId AS stevilkaArtikla, 1 AS kolicina, \
    Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
    Track.UnitPrice * " + razmerje_usd_eur + " AS cena, 0 AS popust, \
    Genre.Name AS zanr \
    FROM Track, Album, Artist, Genre \
    WHERE Track.AlbumId = Album.AlbumId AND \
    Artist.ArtistId = Album.ArtistId AND \
    Track.GenreId = Genre.GenreId AND \
    Track.TrackId IN (" + zahteva.session.kosarica.join(",") + ")",
    function(napaka, vrstice) {
      if (napaka) {
        callback(false);
      } else {
        for (var i=0; i<vrstice.length; i++) {
          vrstice[i].stopnja = davcnaStopnja((vrstice[i].opisArtikla.split(' (')[1]).split(')')[0], vrstice[i].zanr);
        }
        callback(vrstice);
      }
    })
  }
}

streznik.get('/kosarica', function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi)
      odgovor.sendStatus(500);
    else
      odgovor.send(pesmi);
  });
})

// Vrni podrobnosti pesmi na računu
var pesmiIzRacuna = function(racunId, callback) {
    pb.all("SELECT Track.TrackId AS stevilkaArtikla, 1 AS kolicina, \
    Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
    Track.UnitPrice * " + razmerje_usd_eur + " AS cena, 0 AS popust, \
    Genre.Name AS zanr \
    FROM Track, Album, Artist, Genre \
    WHERE Track.AlbumId = Album.AlbumId AND \
    Artist.ArtistId = Album.ArtistId AND \
    Track.GenreId = Genre.GenreId AND \
    Track.TrackId IN (SELECT InvoiceLine.TrackId FROM InvoiceLine, Invoice \
    WHERE InvoiceLine.InvoiceId = Invoice.InvoiceId AND Invoice.InvoiceId = " + racunId + ")",
    function(napaka, vrstice) {
      if(napaka){
        callback(false);
      } else {
        callback(vrstice);
      }
    })
}

// Vrni podrobnosti o stranki iz računa
var strankaIzRacuna = function(racunId, callback) {
    pb.all("SELECT Customer.* FROM Customer, Invoice \
            WHERE Customer.CustomerId = Invoice.CustomerId AND Invoice.InvoiceId = " + racunId,
    function(napaka, vrstice) {
      console.log(vrstice);
    })
}

// Izpis računa v HTML predstavitvi na podlagi podatkov iz baze
streznik.post('/izpisiRacunBaza', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  form.parse(zahteva, function (napaka1, polja, datoteke) {
    var izbraniRacun = polja.seznamRacunov;
    console.log(izbraniRacun);
    if(izbraniRacun>-1){ 
    vrniRacune(function(napaka2, racuni) {
      var ime_narocnika;
      for(var obj in racuni){
        if(racuni[obj].InvoiceId==izbraniRacun){
          ime_narocnika=racuni[obj].Naziv;
          break;
        }
      }
      var spl = ime_narocnika.split(" ");
      ime_narocnika="";
      for(var obj in spl){
        if(spl[obj].charAt(0)=='('){
          break;
        } else {
          ime_narocnika += spl[obj]+" ";                
        }
      }
      
      vrniStranke(function(napaka1, stranke) {
        for(var obj in stranke){
          if(stranke[obj].FirstName.localeCompare(spl[0])==0 && stranke[obj].LastName.localeCompare(spl[1])==0){
            var addres = stranke[obj].Address;
            var city = stranke[obj].City;
            var country = stranke[obj].Country;
            var postalcode = stranke[obj].PostalCode;
            var phone = stranke[obj].Phone;
            var email = stranke[obj].Email;
            var fax = stranke[obj].Fax;
            var company= stranke[obj].Company;
          }
        }
        pesmiIzRacuna(izbraniRacun, function(pesmi) {
          odgovor.setHeader('content-type', 'text/xml');
          odgovor.render('eslog', {
            vizualiziraj:  true,
            postavkeRacuna: pesmi,
            NazivPartnerja1: ime_narocnika,
            City: city,
            Address: addres,
            Company: company,
            Country: country,
            PostalCode: postalcode,
            Phone: phone,
            Fax: fax,
            Email: email
          })
        })
       })
      }) 

    } else {
      odgovor.redirect('/prijava');
    }
  })
})

// Izpis računa v HTML predstavitvi ali izvorni XML obliki
streznik.get('/izpisiRacun/:oblika', function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi) {
      odgovor.sendStatus(500);
    } else if (pesmi.length == 0) {
      odgovor.send("<p>V košarici nimate nobene pesmi, \
        zato računa ni mogoče pripraviti!</p>");
    } else {
      var s = zahteva.session.prijavljenaStranka-1;
      vrniStranke(function(napaka1, stranke) {
       var narocnik_ime=stranke[s].FirstName + " " + stranke[s].LastName;
       var naslov = stranke[s].Address;
       var mesto = stranke[s].City;
       var drzava = stranke[s].Country;
       var posta = stranke[s].PostalCode;
       var phone = stranke[s].Phone;
       var email = stranke[s].Email;
       var fax = stranke[s].Fax;
       var podjetje= stranke[s].Company;
      
      
        odgovor.setHeader('content-type', 'text/xml');
        odgovor.render('eslog', {
        vizualiziraj: zahteva.params.oblika == 'html' ? true : false,
        postavkeRacuna: pesmi,
        NazivPartnerja1: narocnik_ime,
        City: mesto,
        Address: naslov,
        Company: podjetje,
        Country: drzava,
        PostalCode: posta,
        Phone: phone,
        Fax: fax,
        Email: email
        })
      })  
    }
  })
})

// Privzeto izpiši račun v HTML obliki
streznik.get('/izpisiRacun', function(zahteva, odgovor) {
  odgovor.redirect('/izpisiRacun/html')
})

// Vrni stranke iz podatkovne baze
var vrniStranke = function(callback) {
  pb.all("SELECT * FROM Customer",
    function(napaka, vrstice) {
      callback(napaka, vrstice);
    }
  );
}

// Vrni račune iz podatkovne baze
var vrniRacune = function(callback) {
  pb.all("SELECT Customer.FirstName || ' ' || Customer.LastName || ' (' || Invoice.InvoiceId || ') - ' || date(Invoice.InvoiceDate) AS Naziv, \
          Invoice.InvoiceId \
          FROM Customer, Invoice \
          WHERE Customer.CustomerId = Invoice.CustomerId",
    function(napaka, vrstice) {
      callback(napaka, vrstice);
    }
  );
}

// Registracija novega uporabnika
streznik.post('/prijava', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  
  form.parse(zahteva, function (napaka1, polja, datoteke) {
    var napaka2 = false;
    try {
      var stmt = pb.prepare("\
        INSERT INTO Customer \
    	  (FirstName, LastName, Company, \
    	  Address, City, State, Country, PostalCode, \
    	  Phone, Fax, Email, SupportRepId) \
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
      
      stmt.run(polja.FirstName, polja.LastName, polja.Company, polja.Address, polja.City, polja.State, polja.Country, polja.PostalCode, polja.Phone, polja.Fax, polja.Email, 3); 
      stmt.finalize();
      
      vrniStranke(function(napaka1, stranke) {
      vrniRacune(function(napaka2, racuni) {
        odgovor.render('prijava', {sporocilo: "Stranka je bila uspešno registrirana", seznamStrank: stranke, seznamRacunov: racuni});  
      }) 
    });
      
      
    } catch (err) {
      napaka2 = true;
      vrniStranke(function(napaka1, stranke) {
      vrniRacune(function(napaka2, racuni) {
        odgovor.render('prijava', {sporocilo: "Prišlo je do napake pri registraciji nove stranke. Prosim preverite vnešene podatke in poskusite znova.", seznamStrank: stranke, seznamRacunov: racuni});  
      }) 
    });
    }
  
  });
  
  
})

// Prikaz strani za prijavo
streznik.get('/prijava', function(zahteva, odgovor) {
  vrniStranke(function(napaka1, stranke) {
      vrniRacune(function(napaka2, racuni) {
        odgovor.render('prijava', {sporocilo: "", seznamStrank: stranke, seznamRacunov: racuni});  
      }) 
    });
})

// Prikaz nakupovalne košarice za stranko
streznik.post('/stranka', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  
  form.parse(zahteva, function (napaka1, polja, datoteke) {

    zahteva.session.prijavljenaStranka = polja.seznamStrank;
    odgovor.redirect('/')

  });
})

// Odjava stranke
streznik.post('/odjava', function(zahteva, odgovor) {

    zahteva.session.prijavljenaStranka = null;
    odgovor.redirect('/prijava') 

})



streznik.listen(process.env.PORT, function() {
  console.log("Strežnik pognan!");
})