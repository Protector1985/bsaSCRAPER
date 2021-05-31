const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const keys = require('./keys.json')
const streets = require("./streetData.js")
const {google} = require('googleapis')










console.log(streets);

const client = new google.auth.JWT(
    keys.client_email, 
    null, 
    keys.private_key, 
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const port = ['9054','9053','9050', '9052' ]

client.authorize( async (err, tokens) => {
    if(err) {
        console.log(err);
        return;
    } else {
        console.log("Connected")

        const browser = await puppeteer.launch({
            headless: false,
            slowMo: 65,
            args: [`--proxy-server=socks5://127.0.0.1:9054`]
        }); //launches the browser headless mode
        
        const page = await browser.newPage();
        await page.goto("https://bsaonline.com/OnlinePayment/OnlinePaymentSearch?PaymentApplicationType=5&uid=405",{waitUntil: 'domcontentloaded', timeout:120000})
        
        
        
        for(let n = 0 ; n < streets.length ; n ++) {
            await page.$eval("#SearchText", el => el.value = '');
            await page.type("#SearchText", streets[n])
            await page.keyboard.press('Enter')
        
            await page.waitForSelector('#DetailGrid', {
                visible:true,
                timeout: 120000
            })
            
            await scrape(page, streets[n], client, port[n]).catch((err) => {
                if(err) {
                    console.log(streets[n]);
                    return;
                    
                }
            })
        
        
        }
    }
});

async function scrape(page, streetName, googleClient, port) {
    
    const gsapi = google.sheets({version: "v4", auth: googleClient})
    

    //code below checks how many pages should be parsed
    const evalPages = await page.evaluate(() => {
        const numPagesNodes = document.querySelector("#DetailGrid .t-widget .t-grid-pager .t-pager .t-numeric").lastElementChild.innerText;
        return numPagesNodes
    })
    
    const numberOfPages = Number(evalPages)
    
    //code below parses page table for addresses and puts these addresses into the masterList array
    async function getPageAddresses() {
        let masterList = [];
        for (let i = 0 ; i <= numberOfPages ; i ++) {
            await page.waitForSelector('#DetailGrid', {
                visible:true,
                timeout: 129000
            })
            const addressTable = await page.evaluate(() => {
            const listOfNodes = document.querySelectorAll("#DetailGrid table tbody .site-search-row td");
            const nodeArray = Array.from(listOfNodes);
            return nodeArray.map((item => {
                    return item.textContent  
            }))
            
        })
            const newArr = addressTable.filter((elem) => elem.includes(streetName.toUpperCase()) && !elem.includes("LLC"))
        
            for(let z = 0 ; z < newArr.length ; z ++) {
                masterList.push(newArr[z])
            }
            await page.click('#DetailGrid .t-grid-pager .t-pager .t-arrow-next')
        }

        function hasNumbers(t){ //function to determine if there is a number in the address - if not erase from array
            var regex = /\d/g;
            return regex.test(t);
        }    
      
        const listOfAddresses = masterList.filter((item, index) => masterList.indexOf(item) === index);
        const filteredAddresses = listOfAddresses.filter((item) => {
            if(hasNumbers(item)){
                return item
            }})
        console.log(filteredAddresses);
        
        return Array.from(filteredAddresses)
    
    }   


    

    async function processAddresses(addressArray) {
        
        
        for(let i = 0 ; i < addressArray.length ; i ++) {
            await page.$eval("#SearchText", el => el.value = '');
            await page.type("#SearchText", addressArray[i])
            await page.keyboard.press('Enter')
            await page.waitForSelector('#DetailGrid', {
                visible:true,
                timeout: 120000
            })

            const flag = await page.evaluate(() => {
                const flag = document.querySelector("#DetailGrid tbody tr").firstElementChild.textContent;
                return flag
            })

            if(flag === "No records to display.") {
                continue;
            } else {
            await page.click('#DetailGrid tbody .site-search-row')
            await page.waitForSelector('.TaxDetailContents', {
                visible:true,
                timeout: 120000
            })
            
            
            const evalDelinquent = await page.evaluate(() => {
                const evaluationArray = []
                const evalNode = document.querySelectorAll(".widthContainer .grid-container table tbody .container-row")
                const nodeArr = Array.from(evalNode).slice(0,4);
                const arr = nodeArr.map((elem) => elem.textContent)

                const evalArray = arr.filter((elem) => elem.includes("Delinquent") || elem.includes("Forfeiture"))
                return evalArray.length;
            })

            if(evalDelinquent === 2) { // only fires if two years tax delinquent or delinquent + forefiture
                const rowEntry = await page.evaluate(() => {
                    const ownerNode = document.querySelector(".widthContainer table tbody tr td").innerHTML.split("<br>") //creates an array pushing everything else into array
                    const addressNode = document.querySelector("form .sresult-detail .detail-header .sresult-header1 .sresult-header1-address").textContent
                    const cityNode = document.querySelector("form .sresult-detail .detail-header .sresult-header1 span:last-child").textContent.replace("(Property Address)", "")
                    const delinquentAmount = document.querySelector(".AmountsDuePanel table tbody tr td:last-child").textContent
                    ownerNode.push(delinquentAmount)
                    ownerNode.unshift(cityNode)
                    ownerNode.unshift(addressNode)
                    return ownerNode
                     
                })

                const rowSupplement = await page.evaluate(() => {
                    const taxNode = document.querySelector(".widthContainer table tbody tr td:last-child").innerHTML.split("<br>")
                    return taxNode
                })
                const rowData = Array.from(rowEntry)
                const taxAddress = Array.from(rowSupplement)
                
                
                
                if( taxAddress.length < 5 ) {
                    rowData.splice(6, 0, taxAddress[0])
                    rowData.splice(7, 0, " ")
                    rowData.splice(8, 0, taxAddress[1])
                    rowData.splice(9, 0, taxAddress[2])
                    
                } else {
                    rowData.splice(6, 0, taxAddress[0])
                    rowData.splice(7, 0, taxAddress[1])
                    rowData.splice(8, 0, taxAddress[2])
                    rowData.splice(9, 0, taxAddress[3])
                }
                

                
                const getOptions = {
                    spreadsheetId: "1NJtQk5nsOVeVNeqk3vR-wOqesLHe3TJE6zTFYS-mYnA",
                    range:"Sheet1!A1:N"
                }
                
                let data = await gsapi.spreadsheets.values.get(getOptions);
                const numRows = data.data.values.length;
                console.log(rowEntry.length)

                
                
                async function updateSpreadsheet(rowInput) {
                    const updateOptions = {
                        spreadsheetId: "1NJtQk5nsOVeVNeqk3vR-wOqesLHe3TJE6zTFYS-mYnA",
                        range: `Sheet1!A${numRows+1}:N`, //string template to start new data after last filled row
                        valueInputOption: 'USER_ENTERED',
                        resource: {values: [rowInput]}
                    }
                    let res = await gsapi.spreadsheets.values.update(updateOptions);
                    
                    
                    }
                    if(rowEntry.length < 8) {
                        rowData.splice(5,1)
                        rowData.splice(3,0, " ") 
                        console.log(rowData);
                        updateSpreadsheet(rowData)
                        
                    } else {
                        
                        console.log("fired with Trust")
                        rowData.splice(10,1)
                        console.log(rowData)
                        updateSpreadsheet(rowData)
                        
                    }

                }

                if(i === addressArray.length) {
                    await browser.close();
                }
            
            
        }
    }
        

    }

    // const testArrayAddress = ["24 N ROSE ST"]
    // const negTest = ["842 HAYS PARK AVE"]
    const addrArr = await getPageAddresses()
    await processAddresses(addrArr)
    
    

   
}




